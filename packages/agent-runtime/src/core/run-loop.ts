/**
 * Agent execution loop
 */

import { buildArray } from '@codebuff/common/util/array'
import { getErrorObject } from '@codebuff/common/util/error'
import { userMessage } from '@codebuff/common/util/messages'
import { mapValues } from 'lodash'
import { APICallError, type ToolSet } from 'ai'

import { callTokenCountAPI } from '../llm-api/codebuff-web-api'
import { runProgrammaticStep } from '../run-programmatic-step'
import { additionalSystemPrompts } from '../system-prompt/prompts'
import { getAgentTemplate } from '../templates/agent-registry'
import { buildAgentToolSet } from '../templates/prompts'
import { getAgentPrompt } from '../templates/strings'
import { getToolSet } from '../tools/prompts'
import { getAgentOutput } from '../util/agent-output'
import {
  withSystemInstructionTags,
  withSystemTags,
  buildUserMessageContent,
  expireMessages,
} from '../util/messages'
import { countTokensJson } from '../util/token-counter'
import { buildAdditionalToolDefinitions } from './tool-definitions'
import { runAgentStep } from './run-step'

import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type {
  AddAgentStepFn,
  FinishAgentRunFn,
  StartAgentRunFn,
} from '@codebuff/common/types/contracts/database'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ParamsExcluding } from '@codebuff/common/types/function-params'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'
import type {
  AgentTemplateType,
  AgentState,
  AgentOutput,
} from '@codebuff/common/types/session-state'
import type { CustomToolDefinitions, ProjectFileContext } from '@codebuff/common/util/file'
import type { getMCPToolData } from '../mcp'
import type { RunAgentStepParams } from './run-step'

export type LoopAgentStepsResult = {
  agentState: AgentState
  output: AgentOutput
}

export type LoopAgentStepsParams = {
  addAgentStep: AddAgentStepFn
  agentState: AgentState
  agentType: AgentTemplateType
  clearUserPromptMessagesAfterResponse?: boolean
  clientSessionId: string
  content?: Array<TextPart | ImagePart>
  fileContext: ProjectFileContext
  finishAgentRun: FinishAgentRunFn
  localAgentTemplates: Record<string, AgentTemplate>
  logger: Logger
  parentSystemPrompt?: string
  parentTools?: ToolSet
  prompt: string | undefined
  signal: AbortSignal
  spawnParams: Record<string, any> | undefined
  startAgentRun: StartAgentRunFn
  userId: string | undefined
  userInputId: string
  agentTemplate?: AgentTemplate
} & ParamsExcluding<typeof buildAdditionalToolDefinitions, 'agentTemplate'> &
  ParamsExcluding<
    typeof runProgrammaticStep,
    | 'agentState'
    | 'onCostCalculated'
    | 'prompt'
    | 'runId'
    | 'stepNumber'
    | 'stepsComplete'
    | 'system'
    | 'template'
    | 'toolCallParams'
    | 'tools'
  > &
  ParamsExcluding<typeof getAgentTemplate, 'agentId'> &
  ParamsExcluding<
    typeof getAgentPrompt,
    | 'agentTemplate'
    | 'promptType'
    | 'agentTemplates'
    | 'additionalToolDefinitions'
  > &
  ParamsExcluding<
    typeof getMCPToolData,
    'toolNames' | 'mcpServers' | 'writeTo'
  > &
  ParamsExcluding<StartAgentRunFn, 'agentId' | 'ancestorRunIds'> &
  ParamsExcluding<
    FinishAgentRunFn,
    'runId' | 'status' | 'totalSteps' | 'directCredits' | 'totalCredits'
  > &
  ParamsExcluding<
    RunAgentStepParams,
    | 'additionalToolDefinitions'
    | 'agentState'
    | 'agentTemplate'
    | 'prompt'
    | 'runId'
    | 'spawnParams'
    | 'system'
    | 'tools'
  > &
  ParamsExcluding<
    AddAgentStepFn,
    | 'agentRunId'
    | 'stepNumber'
    | 'credits'
    | 'childRunIds'
    | 'messageId'
    | 'status'
    | 'startTime'
  >

/**
 * Resolves agent template from type or provided template
 */
async function resolveAgentTemplate(
  params: LoopAgentStepsParams,
): Promise<AgentTemplate> {
  if (params.agentTemplate) {
    return params.agentTemplate
  }

  const template = await getAgentTemplate({
    ...params,
    agentId: params.agentType,
  })

  if (!template) {
    throw new Error(`Agent template not found for type: ${params.agentType}`)
  }

  return template
}

/**
 * Builds system prompt for agent
 */
async function buildSystemPrompt(params: {
  agentTemplate: AgentTemplate
  parentSystemPrompt?: string
  localAgentTemplates: Record<string, AgentTemplate>
  additionalToolDefinitions: () => Promise<CustomToolDefinitions>
  otherParams: LoopAgentStepsParams
}): Promise<string> {
  const { agentTemplate, parentSystemPrompt, localAgentTemplates, additionalToolDefinitions, otherParams } = params

  if (agentTemplate.inheritParentSystemPrompt && parentSystemPrompt) {
    return parentSystemPrompt
  }

  const systemPrompt = await getAgentPrompt({
    ...otherParams,
    agentTemplate,
    promptType: { type: 'systemPrompt' },
    agentTemplates: localAgentTemplates,
    additionalToolDefinitions,
  })

  return systemPrompt ?? ''
}

/**
 * Builds tool set for agent
 */
async function buildTools(params: {
  agentTemplate: AgentTemplate
  useParentTools: boolean
  parentTools?: ToolSet
  localAgentTemplates: Record<string, AgentTemplate>
  additionalToolDefinitions: () => Promise<CustomToolDefinitions>
  otherParams: LoopAgentStepsParams
}): Promise<ToolSet> {
  const { agentTemplate, useParentTools, parentTools, localAgentTemplates, additionalToolDefinitions, otherParams } = params

  if (useParentTools && parentTools) {
    return parentTools
  }

  const agentTools = await buildAgentToolSet({
    ...otherParams,
    spawnableAgents: agentTemplate.spawnableAgents,
    agentTemplates: localAgentTemplates,
  })

  return getToolSet({
    toolNames: agentTemplate.toolNames,
    additionalToolDefinitions,
    agentTools,
  })
}

/**
 * Builds initial messages for the agent loop
 */
function buildInitialMessages(params: {
  existingMessages: Message[]
  prompt: string | undefined
  spawnParams: Record<string, any> | undefined
  content?: Array<TextPart | ImagePart>
  instructionsPrompt: string | undefined
}): Message[] {
  const { existingMessages, prompt, spawnParams, content, instructionsPrompt } = params

  const hasUserMessage = Boolean(
    prompt ||
    (spawnParams && Object.keys(spawnParams).length > 0) ||
    (content && content.length > 0),
  )

  return buildArray<Message>(
    ...existingMessages,

    hasUserMessage && [
      {
        role: 'user' as const,
        content: buildUserMessageContent(prompt, spawnParams, content),
        tags: ['USER_PROMPT'],
        sentAt: Date.now(),
        keepDuringTruncation: true,
      },
      prompt &&
        prompt in additionalSystemPrompts &&
        userMessage(
          withSystemInstructionTags(
            additionalSystemPrompts[
              prompt as keyof typeof additionalSystemPrompts
            ],
          ),
        ),
    ],

    instructionsPrompt &&
      userMessage({
        content: instructionsPrompt,
        tags: ['INSTRUCTIONS_PROMPT'],
        keepLastTags: ['INSTRUCTIONS_PROMPT'],
      }),
  )
}

/**
 * Handles error in agent execution
 */
function handleExecutionError(params: {
  error: unknown
  agentType: AgentTemplateType
  agentState: AgentState
  runId: string
  totalSteps: number
  system: string
  logger: Logger
}): { errorMessage: string; statusCode?: number } {
  const { error, agentType, agentState, runId, totalSteps, system, logger } = params

  logger.error(
    {
      error: getErrorObject(error),
      agentType,
      agentId: agentState.agentId,
      runId,
      totalSteps,
      directCreditsUsed: agentState.directCreditsUsed,
      creditsUsed: agentState.creditsUsed,
      messageHistory: agentState.messageHistory,
      systemPrompt: system,
    },
    'Agent execution failed',
  )

  let errorMessage = ''
  if (error instanceof APICallError) {
    errorMessage = `${error.message}`
  } else {
    errorMessage =
      error instanceof Error
        ? error.message + (error.stack ? `\n\n${error.stack}` : '')
        : String(error)
  }

  const statusCode = (error as { statusCode?: number }).statusCode

  return { errorMessage, statusCode }
}

/**
 * Main agent execution loop
 */
export async function loopAgentSteps(
  params: LoopAgentStepsParams,
): Promise<LoopAgentStepsResult> {
  const {
    addAgentStep,
    agentState: initialAgentState,
    agentType,
    clearUserPromptMessagesAfterResponse = true,
    clientSessionId,
    content,
    fileContext,
    finishAgentRun,
    localAgentTemplates,
    logger,
    parentSystemPrompt,
    parentTools,
    prompt,
    signal,
    spawnParams,
    startAgentRun,
    userId,
    userInputId,
    clientEnv,
    ciEnv,
  } = params

  // Resolve agent template
  const agentTemplate = await resolveAgentTemplate(params)

  // Check if already cancelled
  if (signal.aborted) {
    return {
      agentState: initialAgentState,
      output: {
        type: 'error',
        message: 'Run cancelled by user',
      },
    }
  }

  // Start agent run
  const runId = await startAgentRun({
    ...params,
    agentId: agentTemplate.id,
    ancestorRunIds: initialAgentState.ancestorRunIds,
  })
  if (!runId) {
    throw new Error('Failed to start agent run')
  }
  initialAgentState.runId = runId

  // Setup tool definitions cache
  let cachedAdditionalToolDefinitions: CustomToolDefinitions | undefined
  const additionalToolDefinitionsWithCache = async () => {
    if (!cachedAdditionalToolDefinitions) {
      cachedAdditionalToolDefinitions = await buildAdditionalToolDefinitions({
        ...params,
        agentTemplate,
      })
    }
    return cachedAdditionalToolDefinitions
  }

  const useParentTools =
    agentTemplate.inheritParentSystemPrompt && parentTools !== undefined

  // Get instructions prompt
  const instructionsPrompt = await getAgentPrompt({
    ...params,
    agentTemplate,
    promptType: { type: 'instructionsPrompt' },
    agentTemplates: localAgentTemplates,
    useParentTools,
    additionalToolDefinitions: additionalToolDefinitionsWithCache,
  })

  // Build system prompt
  const system = await buildSystemPrompt({
    agentTemplate,
    parentSystemPrompt,
    localAgentTemplates,
    additionalToolDefinitions: additionalToolDefinitionsWithCache,
    otherParams: params,
  })

  // Build tools
  const tools = await buildTools({
    agentTemplate,
    useParentTools,
    parentTools,
    localAgentTemplates,
    additionalToolDefinitions: additionalToolDefinitionsWithCache,
    otherParams: params,
  })

  // Build initial messages
  const initialMessages = buildInitialMessages({
    existingMessages: initialAgentState.messageHistory,
    prompt,
    spawnParams,
    content,
    instructionsPrompt,
  })

  // Convert tools to serializable format
  const toolDefinitions = mapValues(tools, (tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema as {},
  }))

  // Initialize loop state
  let currentAgentState: AgentState = {
    ...initialAgentState,
    messageHistory: initialMessages,
    systemPrompt: system,
    toolDefinitions,
  }
  let shouldEndTurn = false
  let hasRetriedOutputSchema = false
  let currentPrompt = prompt
  let currentParams = spawnParams
  let totalSteps = 0
  let nResponses: string[] | undefined = undefined

  try {
    while (true) {
      totalSteps++

      // Check cancellation
      if (signal.aborted) {
        logger.info(
          {
            userId,
            userInputId,
            clientSessionId,
            totalSteps,
            runId,
          },
          'Agent run cancelled by user',
        )
        break
      }

      const startTime = new Date()

      // Get step prompt for token counting
      const stepPrompt = await getAgentPrompt({
        ...params,
        agentTemplate,
        promptType: { type: 'stepPrompt' },
        fileContext,
        agentState: currentAgentState,
        agentTemplates: localAgentTemplates,
        logger,
        additionalToolDefinitions: additionalToolDefinitionsWithCache,
      })

      const messagesWithStepPrompt = buildArray(
        ...currentAgentState.messageHistory,
        stepPrompt && userMessage({ content: stepPrompt }),
      )

      // Get token count
      const tokenCountResult = await callTokenCountAPI({
        messages: messagesWithStepPrompt,
        system,
        fetch,
        logger,
        env: { clientEnv, ciEnv },
      })

      if (tokenCountResult.inputTokens !== undefined) {
        currentAgentState.contextTokenCount = tokenCountResult.inputTokens
      } else if (tokenCountResult.error) {
        logger.warn(
          { error: tokenCountResult.error },
          'Failed to get token count from Anthropic API',
        )
        const estimatedTokens =
          countTokensJson(currentAgentState.messageHistory) +
          countTokensJson(system) +
          countTokensJson(toolDefinitions)
        currentAgentState.contextTokenCount = estimatedTokens
      }

      // Run programmatic step if exists
      let n: number | undefined = undefined

      if (agentTemplate.handleSteps) {
        const programmaticResult = await runProgrammaticStep({
          ...params,
          agentState: currentAgentState,
          localAgentTemplates,
          nResponses,
          onCostCalculated: async (credits: number) => {
            currentAgentState.creditsUsed += credits
            currentAgentState.directCreditsUsed += credits
          },
          prompt: currentPrompt,
          runId,
          stepNumber: totalSteps,
          stepsComplete: shouldEndTurn,
          system,
          tools,
          template: agentTemplate,
          toolCallParams: currentParams,
        })

        const {
          agentState: programmaticAgentState,
          endTurn,
          stepNumber,
          generateN,
        } = programmaticResult

        n = generateN
        currentAgentState = programmaticAgentState
        totalSteps = stepNumber
        shouldEndTurn = endTurn
      }

      // Check if output is required but missing
      if (
        agentTemplate.outputSchema &&
        currentAgentState.output === undefined &&
        shouldEndTurn &&
        !hasRetriedOutputSchema
      ) {
        hasRetriedOutputSchema = true
        logger.warn(
          {
            agentType,
            agentId: currentAgentState.agentId,
            runId,
          },
          'Agent finished without setting required output, restarting loop',
        )

        const outputSchemaMessage = withSystemTags(
          `You must use the "set_output" tool to provide a result that matches the output schema before ending your turn. The output schema is required for this agent.`,
        )

        currentAgentState.messageHistory = [
          ...currentAgentState.messageHistory,
          userMessage({
            content: outputSchemaMessage,
            keepDuringTruncation: true,
          }),
        ]

        shouldEndTurn = false
      }

      // Check if should end
      if (shouldEndTurn) {
        break
      }

      // Run agent step
      const creditsBefore = currentAgentState.directCreditsUsed
      const childrenBefore = currentAgentState.childRunIds.length

      const {
        agentState: newAgentState,
        shouldEndTurn: llmShouldEndTurn,
        messageId,
        nResponses: generatedResponses,
      } = await runAgentStep({
        ...params,
        agentState: currentAgentState,
        agentTemplate,
        n,
        prompt: currentPrompt,
        runId,
        spawnParams: currentParams,
        system,
        tools,
        additionalToolDefinitions: additionalToolDefinitionsWithCache,
      })

      // Record step
      if (newAgentState.runId) {
        await addAgentStep({
          ...params,
          agentRunId: newAgentState.runId,
          stepNumber: totalSteps,
          credits: newAgentState.directCreditsUsed - creditsBefore,
          childRunIds: newAgentState.childRunIds.slice(childrenBefore),
          messageId,
          status: 'completed',
          startTime,
        })
      } else {
        logger.error('No runId found for agent state after finishing agent run')
      }

      currentAgentState = newAgentState
      shouldEndTurn = llmShouldEndTurn
      nResponses = generatedResponses

      currentPrompt = undefined
      currentParams = undefined
    }

    // Clear user prompt messages if requested
    if (clearUserPromptMessagesAfterResponse) {
      currentAgentState.messageHistory = expireMessages(
        currentAgentState.messageHistory,
        'userPrompt',
      )
    }

    // Finish run
    const status = signal.aborted ? 'cancelled' : 'completed'
    await finishAgentRun({
      ...params,
      runId,
      status,
      totalSteps,
      directCredits: currentAgentState.directCreditsUsed,
      totalCredits: currentAgentState.creditsUsed,
    })

    return {
      agentState: currentAgentState,
      output: getAgentOutput(currentAgentState, agentTemplate),
    }
  } catch (error) {
    const { errorMessage, statusCode } = handleExecutionError({
      error,
      agentType,
      agentState: currentAgentState,
      runId,
      totalSteps,
      system,
      logger,
    })

    const status = signal.aborted ? 'cancelled' : 'failed'
    await finishAgentRun({
      ...params,
      runId,
      status,
      totalSteps,
      directCredits: currentAgentState.directCreditsUsed,
      totalCredits: currentAgentState.creditsUsed,
      errorMessage,
    })

    // Payment required errors (402) should propagate
    if (statusCode === 402) {
      throw error
    }

    return {
      agentState: currentAgentState,
      output: {
        type: 'error',
        message: 'Agent run error: ' + errorMessage,
        ...(statusCode !== undefined && { statusCode }),
      },
    }
  }
}
