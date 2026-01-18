/**
 * Agent step execution - handles single step execution logic
 * Extracted from run-agent-step.ts for focused responsibility
 */

import { insertTrace } from '@codebuff/bigquery'
import { TOOLS_WHICH_WONT_FORCE_NEXT_STEP } from '@codebuff/common/tools/constants'
import { userMessage } from '@codebuff/common/util/messages'

import {
  withSystemTags,
  expireMessages,
} from '../util/messages'

import type { AgentResponseTrace } from '@codebuff/bigquery'
import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ToolMessage } from '@codebuff/common/types/messages/codebuff-message'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentState } from '@codebuff/common/types/session-state'
import type { AgentStepResult } from './types'

export const STEP_WARNING_MESSAGE = [
  "I've made quite a few responses in a row.",
  "Let me pause here to make sure we're still on the right track.",
  "Please let me know if you'd like me to continue or if you'd like to guide me in a different direction.",
].join(' ')

/**
 * Checks if agent has exceeded maximum steps
 */
export function checkStepLimit(params: {
  agentState: AgentState
  logger: Logger
  onResponseChunk: (chunk: string | PrintModeEvent) => void
}): AgentStepResult | null {
  const { agentState, logger, onResponseChunk } = params

  if (agentState.stepsRemaining <= 0) {
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

  return null
}

/**
 * Parses multiple LLM responses from a JSON string
 */
export function parseMultipleResponses(responsesString: string, n: number): string[] {
  try {
    const nResponses = JSON.parse(responsesString) as string[]
    if (!Array.isArray(nResponses)) {
      if (n > 1) {
        throw new Error(
          `Expected JSON array response from LLM when n > 1, got non-array: ${responsesString.slice(0, 50)}`,
        )
      }
      return [responsesString]
    }
    return nResponses
  } catch (e) {
    if (n > 1) {
      throw e
    }
    return [responsesString]
  }
}

/**
 * Determines if the agent should end its turn based on tool calls
 */
export function shouldAgentEndTurn(params: {
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
 * Handles the /compact command to summarize conversation
 */
export function handleCompactCommand(params: {
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
 * Logs and traces the agent response
 */
export function traceAgentResponse(params: {
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
