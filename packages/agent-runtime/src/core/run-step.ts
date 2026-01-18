/**
 * Single agent step execution
 */

import { insertTrace } from '@codebuff/bigquery'
import { AnalyticsEvent } from '@codebuff/common/constants/analytics-events'
import { supportsCacheControl } from '@codebuff/common/old-constants'
import { TOOLS_WHICH_WONT_FORCE_NEXT_STEP } from '@codebuff/common/tools/constants'
import { buildArray } from '@codebuff/common/util/array'
import { systemMessage, userMessage } from '@codebuff/common/util/messages'

import { getAgentStreamFromTemplate } from '../prompt-agent-stream'
import { getAgentPrompt } from '../templates/strings'
import { processStream } from '../tools/stream-parser'
import {
  withSystemTags,
  expireMessages,
} from '../util/messages'
import { countTokensJson } from '../util/token-counter'
import { STEP_WARNING_MESSAGE } from './constants'

import type { AgentResponseTrace } from '@codebuff/bigquery'
import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { TrackEventFn } from '@codebuff/common/types/contracts/analytics'
import type { PromptAiSdkFn } from '@codebuff/common/types/contracts/llm'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ParamsExcluding } from '@codebuff/common/types/function-params'
import type {
  Message,
  ToolMessage,
} from '@codebuff/common/types/messages/codebuff-message'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type {
  AgentTemplateType,
  AgentState,
} from '@codebuff/common/types/session-state'
import type { ProjectFileContext } from '@codebuff/common/util/file'
import type { getMCPToolData } from '../mcp'
import type { getAgentTemplate } from '../templates/agent-registry'

export type RunAgentStepResult = {
  agentState: AgentState
  fullResponse: string
  shouldEndTurn: boolean
  messageId: string | null
  nResponses?: string[]
}

export type RunAgentStepParams = {
  userId: string | undefined
  userInputId: string
  clientSessionId: string
  fingerprintId: string
  repoId: string | undefined
  onResponseChunk: (chunk: string | PrintModeEvent) => void

  agentType: AgentTemplateType
  agentTemplate: AgentTemplate
  fileContext: ProjectFileContext
  agentState: AgentState
  localAgentTemplates: Record<string, AgentTemplate>

  prompt: string | undefined
  spawnParams: Record<string, any> | undefined
  system: string
  n?: number

  trackEvent: TrackEventFn
  promptAiSdk: PromptAiSdkFn
} & ParamsExcluding<
  typeof processStream,
  | 'agentContext'
  | 'agentState'
  | 'agentStepId'
  | 'agentTemplate'
  | 'fullResponse'
  | 'messages'
  | 'onCostCalculated'
  | 'repoId'
  | 'stream'
> &
  ParamsExcluding<
    typeof getAgentStreamFromTemplate,
    | 'agentId'
    | 'includeCacheControl'
    | 'messages'
    | 'onCostCalculated'
    | 'template'
  > &
  ParamsExcluding<typeof getAgentTemplate, 'agentId'> &
  ParamsExcluding<
    typeof getAgentPrompt,
    'agentTemplate' | 'promptType' | 'agentState' | 'agentTemplates'
  > &
  ParamsExcluding<
    typeof getMCPToolData,
    'toolNames' | 'mcpServers' | 'writeTo'
  > &
  ParamsExcluding<
    PromptAiSdkFn,
    'messages' | 'model' | 'onCostCalculated' | 'n'
  >

/**
 * Handles step limit exceeded case
 */
function handleStepLimitExceeded(params: {
  agentState: AgentState
  logger: Logger
  onResponseChunk: (chunk: string | PrintModeEvent) => void
}): RunAgentStepResult {
  const { agentState, logger, onResponseChunk } = params

  logger.warn(
    `Detected too many consecutive assistant messages without user prompt`,
  )

  onResponseChunk(`${STEP_WARNING_MESSAGE}\n\n`)

  const updatedState = {
    ...agentState,
    messageHistory: [
      ...expireMessages(agentState.messageHistory, 'userPrompt'),
      userMessage(
        withSystemTags(
          `The assistant has responded too many times in a row. The assistant's turn has automatically been ended. The maximum number of responses can be configured via maxAgentSteps.`,
        ),
      ),
    ],
  }

  return {
    agentState: updatedState,
    fullResponse: STEP_WARNING_MESSAGE,
    shouldEndTurn: true,
    messageId: null,
  }
}

/**
 * Handles multiple response generation (n parameter)
 */
async function handleMultipleResponses(params: {
  agentState: AgentState
  model: string
  n: number
  promptAiSdk: PromptAiSdkFn
  onCostCalculated: (credits: number) => Promise<void>
  otherParams: Record<string, any>
}): Promise<RunAgentStepResult> {
  const { agentState, model, n, promptAiSdk, onCostCalculated, otherParams } = params

  const responsesString = await promptAiSdk({
    ...otherParams,
    messages: agentState.messageHistory,
    model,
    n,
    onCostCalculated,
  })

  let nResponses: string[]
  try {
    nResponses = JSON.parse(responsesString) as string[]
    if (!Array.isArray(nResponses)) {
      if (n > 1) {
        throw new Error(
          `Expected JSON array response from LLM when n > 1, got non-array: ${responsesString.slice(0, 50)}`,
        )
      }
      nResponses = [responsesString]
    }
  } catch (e) {
    if (n > 1) {
      throw e
    }
    nResponses = [responsesString]
  }

  return {
    agentState,
    fullResponse: responsesString,
    shouldEndTurn: false,
    messageId: null,
    nResponses,
  }
}

/**
 * Determines if agent should end its turn based on tool calls
 */
function shouldAgentEndTurn(params: {
  toolCalls: Array<{ toolName: string }>
  toolResults: ToolMessage[]
  hadToolCallError: boolean
  agentTemplate: AgentTemplate
}): boolean {
  const { toolCalls, toolResults, hadToolCallError, agentTemplate } = params

  const hasNoToolResults =
    toolCalls.filter(
      (call) => !TOOLS_WHICH_WONT_FORCE_NEXT_STEP.includes(call.toolName),
    ).length === 0 &&
    toolResults.filter(
      (result) => !TOOLS_WHICH_WONT_FORCE_NEXT_STEP.includes(result.toolName),
    ).length === 0 &&
    !hadToolCallError

  const hasTaskCompleted = toolCalls.some(
    (call) =>
      call.toolName === 'task_completed' || call.toolName === 'end_turn',
  )

  const requiresExplicitCompletion =
    agentTemplate.toolNames.includes('task_completed')

  if (requiresExplicitCompletion) {
    return hasTaskCompleted
  }

  return hasTaskCompleted || hasNoToolResults
}

/**
 * Handles /compact command
 */
function handleCompactCommand(params: {
  prompt: string | undefined
  agentState: AgentState
  fullResponse: string
  logger: Logger
}): AgentState {
  const { prompt, agentState, fullResponse, logger } = params

  const wasCompacted =
    prompt &&
    (prompt.toLowerCase() === '/compact' || prompt.toLowerCase() === 'compact')

  if (wasCompacted) {
    logger.debug({ summary: fullResponse }, 'Compacted messages')
    return {
      ...agentState,
      messageHistory: [
        userMessage(
          withSystemTags(
            `The following is a summary of the conversation between you and the user. The conversation continues after this summary:\n\n${fullResponse}`,
          ),
        ),
      ],
    }
  }

  return agentState
}

/**
 * Traces agent response for analytics
 */
function traceAgentResponse(params: {
  agentStepId: string
  userId: string | undefined
  userInputId: string
  clientSessionId: string
  fingerprintId: string
  fullResponse: string
  logger: Logger
}): void {
  const {
    agentStepId,
    userId,
    userInputId,
    clientSessionId,
    fingerprintId,
    fullResponse,
    logger,
  } = params

  const agentResponseTrace: AgentResponseTrace = {
    type: 'agent-response',
    created_at: new Date(),
    agent_step_id: agentStepId,
    user_id: userId ?? '',
    id: crypto.randomUUID(),
    payload: {
      output: fullResponse,
      user_input_id: userInputId,
      client_session_id: clientSessionId,
      fingerprint_id: fingerprintId,
    },
  }

  insertTrace({ trace: agentResponseTrace, logger })
}

/**
 * Executes a single agent step
 */
export const runAgentStep = async (
  params: RunAgentStepParams,
): Promise<RunAgentStepResult> => {
  const {
    agentType,
    clientSessionId,
    fileContext,
    agentTemplate,
    fingerprintId,
    localAgentTemplates,
    logger,
    prompt,
    repoId,
    spawnParams,
    system,
    userId,
    userInputId,
    onResponseChunk,
    promptAiSdk,
    trackEvent,
    additionalToolDefinitions,
  } = params
  let agentState = params.agentState

  const { agentContext } = agentState
  const startTime = Date.now()

  // Generate unique ID for this step
  const agentStepId = crypto.randomUUID()
  trackEvent({
    event: AnalyticsEvent.AGENT_STEP,
    userId: userId ?? '',
    properties: {
      agentStepId,
      clientSessionId,
      fingerprintId,
      userInputId,
      userId,
      repoName: repoId,
    },
    logger,
  })

  // Check step limit
  if (agentState.stepsRemaining <= 0) {
    return handleStepLimitExceeded({ agentState, logger, onResponseChunk })
  }

  // Get step prompt
  const stepPrompt = await getAgentPrompt({
    ...params,
    agentTemplate,
    promptType: { type: 'stepPrompt' },
    fileContext,
    agentState,
    agentTemplates: localAgentTemplates,
    logger,
    additionalToolDefinitions,
  })

  // Build messages
  const agentMessagesUntruncated = buildArray<Message>(
    ...expireMessages(agentState.messageHistory, 'agentStep'),
    stepPrompt &&
      userMessage({
        content: stepPrompt,
        tags: ['STEP_PROMPT'],
        timeToLive: 'agentStep' as const,
        keepDuringTruncation: true,
      }),
  )

  agentState.messageHistory = agentMessagesUntruncated

  const { model } = agentTemplate
  let stepCreditsUsed = 0

  const onCostCalculated = async (credits: number) => {
    stepCreditsUsed += credits
    agentState.creditsUsed += credits
    agentState.directCreditsUsed += credits
  }

  const iterationNum = agentState.messageHistory.length
  const systemTokens = countTokensJson(system)

  logger.debug(
    {
      iteration: iterationNum,
      agentId: agentState.agentId,
      model,
      duration: Date.now() - startTime,
      contextTokenCount: agentState.contextTokenCount,
      agentMessages: agentState.messageHistory,
      system,
      prompt,
      params: spawnParams,
      agentContext,
      systemTokens,
      agentTemplate,
      tools: params.tools,
    },
    `Start agent ${agentType} step ${iterationNum} (${userInputId}${prompt ? ` - Prompt: ${prompt.slice(0, 20)}` : ''})`,
  )

  // Handle n parameter for multiple responses
  if (params.n !== undefined) {
    return handleMultipleResponses({
      agentState,
      model,
      n: params.n,
      promptAiSdk,
      onCostCalculated,
      otherParams: params,
    })
  }

  let fullResponse = ''
  const toolResults: ToolMessage[] = []

  // Get stream from LLM
  const stream = getAgentStreamFromTemplate({
    ...params,
    agentId: agentState.parentId ? agentState.agentId : undefined,
    includeCacheControl: supportsCacheControl(agentTemplate.model),
    messages: [systemMessage(system), ...agentState.messageHistory],
    template: agentTemplate,
    onCostCalculated,
  })

  // Process stream
  const {
    fullResponse: fullResponseAfterStream,
    fullResponseChunks,
    hadToolCallError,
    messageId,
    toolCalls,
    toolResults: newToolResults,
  } = await processStream({
    ...params,
    agentContext,
    agentState,
    agentStepId,
    agentTemplate,
    fullResponse,
    messages: agentState.messageHistory,
    repoId,
    stream,
    onCostCalculated,
  })

  toolResults.push(...newToolResults)
  fullResponse = fullResponseAfterStream

  // Trace response
  traceAgentResponse({
    agentStepId,
    userId,
    userInputId,
    clientSessionId,
    fingerprintId,
    fullResponse,
    logger,
  })

  // Expire step messages
  agentState.messageHistory = expireMessages(
    agentState.messageHistory,
    'agentStep',
  )

  // Handle /compact command
  agentState = handleCompactCommand({
    prompt,
    agentState,
    fullResponse,
    logger,
  })

  // Determine if should end turn
  const shouldEndTurn = shouldAgentEndTurn({
    toolCalls,
    toolResults,
    hadToolCallError,
    agentTemplate,
  })

  // Update state
  agentState = {
    ...agentState,
    stepsRemaining: agentState.stepsRemaining - 1,
    agentContext,
  }

  logger.debug(
    {
      iteration: iterationNum,
      agentId: agentState.agentId,
      model,
      prompt,
      shouldEndTurn,
      duration: Date.now() - startTime,
      fullResponse,
      finalMessageHistoryWithToolResults: agentState.messageHistory,
      toolCalls,
      toolResults,
      agentContext,
      fullResponseChunks,
      stepCreditsUsed,
    },
    `End agent ${agentType} step ${iterationNum} (${userInputId}${prompt ? ` - Prompt: ${prompt.slice(0, 20)}` : ''})`,
  )

  return {
    agentState,
    fullResponse,
    shouldEndTurn,
    messageId,
    nResponses: undefined,
  }
}
