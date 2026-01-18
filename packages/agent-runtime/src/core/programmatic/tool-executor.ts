/**
 * Tool execution for programmatic steps
 */

import { assistantMessage } from '@codebuff/common/util/messages'

import { executeToolCall } from '../../tools/tool-executor'
import { parseTextWithToolCalls } from '../../util/parse-tool-calls-from-text'

import type { ParsedSegment } from '../../util/parse-tool-calls-from-text'
import type { ExecuteToolCallParams } from '../../tools/tool-executor'
import type { ToolMessage } from '@codebuff/common/types/messages/codebuff-message'
import type { ToolCallPart, ToolResultOutput } from '@codebuff/common/types/messages/content-part'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentState } from '@codebuff/common/types/session-state'
import type { ToolCallToExecute, ToolExecutionResult } from './types'

/**
 * Parameters for executing tool calls
 */
export type ExecuteToolCallsArrayParams = Omit<
  ExecuteToolCallParams,
  | 'toolName'
  | 'input'
  | 'autoInsertEndStepParam'
  | 'excludeToolFromMessageHistory'
  | 'toolCallId'
  | 'toolResultsToAddAfterStream'
> & {
  agentState: AgentState
  onResponseChunk: (chunk: string | PrintModeEvent) => void
}

/**
 * Executes a single tool call.
 * Adds the tool call as an assistant message and then executes it.
 */
export async function executeSingleToolCall(
  toolCallToExecute: ToolCallToExecute,
  params: ExecuteToolCallsArrayParams,
): Promise<ToolExecutionResult> {
  const { agentState, onResponseChunk, toolResults } = params

  const toolCallId = crypto.randomUUID()
  const excludeToolFromMessageHistory =
    toolCallToExecute.includeToolCall === false

  // Add assistant message with the tool call before executing it
  if (!excludeToolFromMessageHistory) {
    const toolCallPart: ToolCallPart = {
      type: 'tool-call',
      toolCallId,
      toolName: toolCallToExecute.toolName,
      input: toolCallToExecute.input,
    }
    agentState.messageHistory = [...agentState.messageHistory]
    agentState.messageHistory.push(assistantMessage(toolCallPart))
  }

  // Execute the tool call
  await executeToolCall({
    ...params,
    toolName: toolCallToExecute.toolName as any,
    input: toolCallToExecute.input,
    autoInsertEndStepParam: true,
    excludeToolFromMessageHistory,
    fromHandleSteps: true,
    toolCallId,
    toolResultsToAddAfterStream: [],

    onResponseChunk: (chunk: string | PrintModeEvent) => {
      if (typeof chunk === 'string') {
        onResponseChunk(chunk)
        return
      }

      // Only add parentAgentId if this programmatic agent has a parent (i.e., it's nested)
      if (agentState.parentId) {
        const parentAgentId = agentState.agentId

        switch (chunk.type) {
          case 'subagent_start':
          case 'subagent_finish':
            if (!chunk.parentAgentId) {
              onResponseChunk({
                ...chunk,
                parentAgentId,
              })
              return
            }
            break
          case 'tool_call':
          case 'tool_result': {
            if (!chunk.parentAgentId) {
              onResponseChunk({
                ...chunk,
                parentAgentId,
              })
              return
            }
            break
          }
          default:
            break
        }
      }

      // For other events or top-level spawns, send as-is
      onResponseChunk(chunk)
    },
  })

  // Get the latest tool result
  return toolResults[toolResults.length - 1]?.content
}

/**
 * Executes an array of segments (text and tool calls) sequentially.
 * Text segments are added as assistant messages.
 * Tool calls are added as assistant messages and then executed.
 */
export async function executeSegmentsArray(
  segments: ParsedSegment[],
  params: ExecuteToolCallsArrayParams,
): Promise<ToolExecutionResult> {
  const { agentState, onResponseChunk } = params

  let toolResults: ToolResultOutput[] = []

  for (const segment of segments) {
    if (segment.type === 'text') {
      // Add text as an assistant message
      agentState.messageHistory = [...agentState.messageHistory]
      agentState.messageHistory.push(assistantMessage(segment.text))

      // Stream assistant text
      onResponseChunk(segment.text)
    } else {
      // Handle tool call segment
      const toolResult = await executeSingleToolCall(segment, params)
      if (toolResult) {
        toolResults.push(...toolResult)
      }
    }
  }

  return toolResults
}

/**
 * Parses text and executes tool calls
 */
export async function executeTextWithToolCalls(
  text: string,
  params: ExecuteToolCallsArrayParams,
): Promise<ToolExecutionResult> {
  const segments = parseTextWithToolCalls(text)
  if (segments.length > 0) {
    return executeSegmentsArray(segments, params)
  }
  return undefined
}
