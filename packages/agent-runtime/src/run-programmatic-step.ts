/**
 * Programmatic agent step execution
 * Re-exports from core/programmatic modules
 */

import { getErrorObject } from '@codebuff/common/util/error'
import { assistantMessage } from '@codebuff/common/util/messages'
import { cloneDeep } from 'lodash'
import { HandleStepsYieldValueSchema } from '@codebuff/common/types/agent-template'

import {
  getGenerator,
  setGenerator,
  clearGenerator,
  isInStepAllMode,
  addToStepAllMode,
  removeFromStepAllMode,
  getPublicAgentState,
  executeSingleToolCall,
  executeTextWithToolCalls,
} from './core/programmatic'

import type { ToolCallToExecute } from './core/programmatic'
import type { FileProcessingState } from './tools/handlers/tool/write-file'
import type { ExecuteToolCallParams } from './tools/tool-executor'
import type { CodebuffToolCall } from '@codebuff/common/tools/list'
import type {
  AgentTemplate,
  PublicAgentState,
} from '@codebuff/common/types/agent-template'
import type {
  HandleStepsLogChunkFn,
  SendActionFn,
} from '@codebuff/common/types/contracts/client'
import type { AddAgentStepFn } from '@codebuff/common/types/contracts/database'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ParamsExcluding } from '@codebuff/common/types/function-params'
import type { ToolMessage } from '@codebuff/common/types/messages/codebuff-message'
import type { ToolResultOutput } from '@codebuff/common/types/messages/content-part'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentState } from '@codebuff/common/types/session-state'

// Re-exports for backward compatibility
export { runIdToStepAll, clearAgentGeneratorCache } from './core/programmatic'
export { getPublicAgentState } from './core/programmatic'

export async function runProgrammaticStep(
  params: {
    addAgentStep: AddAgentStepFn
    agentState: AgentState
    clientSessionId: string
    fingerprintId: string
    handleStepsLogChunk: HandleStepsLogChunkFn
    localAgentTemplates: Record<string, AgentTemplate>
    logger: Logger
    nResponses?: string[]
    onResponseChunk: (chunk: string | PrintModeEvent) => void
    prompt: string | undefined
    repoId: string | undefined
    repoUrl: string | undefined
    stepNumber: number
    stepsComplete: boolean
    template: AgentTemplate
    toolCallParams: Record<string, any> | undefined
    sendAction: SendActionFn
    system: string | undefined
    userId: string | undefined
    userInputId: string
  } & Omit<
    ExecuteToolCallParams,
    | 'toolName'
    | 'input'
    | 'autoInsertEndStepParam'
    | 'excludeToolFromMessageHistory'
    | 'agentContext'
    | 'agentStepId'
    | 'agentTemplate'
    | 'fullResponse'
    | 'previousToolCallFinished'
    | 'fileProcessingState'
    | 'toolCallId'
    | 'toolCalls'
    | 'toolResults'
    | 'toolResultsToAddAfterStream'
  > &
    ParamsExcluding<
      AddAgentStepFn,
      | 'agentRunId'
      | 'stepNumber'
      | 'credits'
      | 'childRunIds'
      | 'status'
      | 'startTime'
      | 'messageId'
    >,
): Promise<{
  agentState: AgentState
  endTurn: boolean
  stepNumber: number
  generateN?: number
}> {
  const {
    agentState,
    template,
    clientSessionId,
    prompt,
    toolCallParams,
    nResponses,
    system,
    userId,
    userInputId,
    repoId,
    fingerprintId,
    onResponseChunk,
    localAgentTemplates,
    stepsComplete,
    handleStepsLogChunk,
    sendAction,
    addAgentStep,
    logger,
  } = params
  let { stepNumber } = params

  if (!template.handleSteps) {
    throw new Error('No step handler found for agent template ' + template.id)
  }

  if (!agentState.runId) {
    throw new Error('Agent state has no run ID')
  }

  // Run with either a generator or a sandbox
  const existingGenerator = getGenerator(agentState.runId)
  const activeGenerator = existingGenerator ?? initializeGenerator({
    template,
    agentState,
    prompt,
    toolCallParams,
    userInputId,
    logger,
    handleStepsLogChunk,
  })

  // Store the generator if it was newly created
  if (!existingGenerator) {
    setGenerator(agentState.runId, activeGenerator)
  }

  // Check if we're in STEP_ALL mode
  if (isInStepAllMode(agentState.runId)) {
    if (stepsComplete) {
      removeFromStepAllMode(agentState.runId)
    } else {
      return { agentState, endTurn: false, stepNumber }
    }
  }

  const agentStepId = crypto.randomUUID()

  // Initialize state for tool execution
  const toolCalls: CodebuffToolCall[] = []
  const toolResults: ToolMessage[] = []
  const fileProcessingState: FileProcessingState = {
    promisesByPath: {},
    allPromises: [],
    fileChangeErrors: [],
    fileChanges: [],
    firstFileProcessed: false,
  }
  const agentContext = cloneDeep(agentState.agentContext)

  let toolResult: ToolResultOutput[] | undefined = undefined
  let endTurn = false
  let generateN: number | undefined = undefined

  let startTime = new Date()
  let creditsBefore = agentState.directCreditsUsed
  let childrenBefore = agentState.childRunIds.length

  const executorParams = {
    ...params,
    agentContext,
    agentStepId,
    agentTemplate: template,
    agentState,
    fileProcessingState,
    fullResponse: '',
    previousToolCallFinished: Promise.resolve(),
    toolCalls,
    toolResults,
    onResponseChunk,
  }

  try {
    do {
      startTime = new Date()
      creditsBefore = agentState.directCreditsUsed
      childrenBefore = agentState.childRunIds.length

      const result = activeGenerator.next({
        agentState: getPublicAgentState(
          agentState as AgentState & Required<Pick<AgentState, 'runId'>>,
        ),
        toolResult: toolResult ?? [],
        stepsComplete,
        nResponses,
      })

      if (result.done) {
        endTurn = true
        break
      }

      // Validate the yield value from handleSteps
      const parseResult = HandleStepsYieldValueSchema.safeParse(result.value)
      if (!parseResult.success) {
        throw new Error(
          `Invalid yield value from handleSteps in agent ${template.id}: ${parseResult.error.message}. ` +
            `Received: ${JSON.stringify(result.value)}`,
        )
      }

      if (result.value === 'STEP') {
        break
      }
      if (result.value === 'STEP_ALL') {
        addToStepAllMode(agentState.runId)
        break
      }

      if ('type' in result.value && result.value.type === 'STEP_TEXT') {
        toolResult = await executeTextWithToolCalls(result.value.text, executorParams)
        continue
      }

      if ('type' in result.value && result.value.type === 'GENERATE_N') {
        logger.info({ resultValue: result.value }, 'GENERATE_N yielded')
        generateN = result.value.n
        endTurn = false
        break
      }

      // Process tool calls yielded by the generator
      const toolCall = result.value as ToolCallToExecute

      toolResult = await executeSingleToolCall(toolCall, executorParams)

      if (agentState.runId) {
        await addAgentStep({
          ...params,
          agentRunId: agentState.runId,
          stepNumber,
          credits: agentState.directCreditsUsed - creditsBefore,
          childRunIds: agentState.childRunIds.slice(childrenBefore),
          status: 'completed',
          startTime,
          messageId: null,
        })
      } else {
        logger.error('No runId found for agent state after finishing agent run')
      }
      stepNumber++

      if (toolCall.toolName === 'end_turn') {
        endTurn = true
        break
      }
    } while (true)

    return { agentState, endTurn, stepNumber, generateN }
  } catch (error) {
    return handleProgrammaticError({
      error,
      template,
      agentState,
      stepNumber,
      creditsBefore,
      childrenBefore,
      startTime,
      params,
      addAgentStep,
      logger,
      onResponseChunk,
    })
  } finally {
    if (endTurn) {
      clearGenerator(agentState.runId)
    }
  }
}

/**
 * Initializes a generator for an agent template
 */
function initializeGenerator(params: {
  template: AgentTemplate
  agentState: AgentState
  prompt: string | undefined
  toolCallParams: Record<string, any> | undefined
  userInputId: string
  logger: Logger
  handleStepsLogChunk: HandleStepsLogChunkFn
}) {
  const { template, agentState, prompt, toolCallParams, userInputId, logger, handleStepsLogChunk } = params

  const createLogMethod =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (data: any, msg?: string) => {
      logger[level](data, msg)
      handleStepsLogChunk({
        userInputId,
        runId: agentState.runId ?? 'undefined',
        level,
        data,
        message: msg,
      })
    }

  const streamingLogger = {
    debug: createLogMethod('debug'),
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
  }

  const generatorFn =
    typeof template.handleSteps === 'string'
      ? eval(`(${template.handleSteps})`)
      : template.handleSteps

  return generatorFn({
    agentState,
    prompt,
    params: toolCallParams,
    logger: streamingLogger,
  })
}

/**
 * Handles errors in programmatic step execution
 */
async function handleProgrammaticError(params: {
  error: unknown
  template: AgentTemplate
  agentState: AgentState
  stepNumber: number
  creditsBefore: number
  childrenBefore: number
  startTime: Date
  params: any
  addAgentStep: AddAgentStepFn
  logger: Logger
  onResponseChunk: (chunk: string | PrintModeEvent) => void
}): Promise<{
  agentState: AgentState
  endTurn: boolean
  stepNumber: number
  generateN?: number
}> {
  const {
    error,
    template,
    agentState,
    stepNumber,
    creditsBefore,
    childrenBefore,
    startTime,
    addAgentStep,
    logger,
    onResponseChunk,
  } = params

  const errorMessage = `Error executing handleSteps for agent ${template.id}: ${
    error instanceof Error ? error.message : 'Unknown error'
  }`
  logger.error(
    { error: getErrorObject(error), template: template.id },
    errorMessage,
  )

  onResponseChunk(errorMessage)

  agentState.messageHistory.push(assistantMessage(errorMessage))
  agentState.output = {
    ...agentState.output,
    error: errorMessage,
  }

  if (agentState.runId) {
    await addAgentStep({
      ...params.params,
      agentRunId: agentState.runId,
      stepNumber,
      credits: agentState.directCreditsUsed - creditsBefore,
      childRunIds: agentState.childRunIds.slice(childrenBefore),
      status: 'skipped',
      startTime,
      errorMessage,
      messageId: null,
      logger,
    })
  } else {
    logger.error('No runId found for agent state after failed agent run')
  }

  return {
    agentState,
    endTurn: true,
    stepNumber: stepNumber + 1,
    generateN: undefined,
  }
}
