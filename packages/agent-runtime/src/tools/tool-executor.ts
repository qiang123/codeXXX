import { generateCompactId } from '@codebuff/common/util/string'
import { cloneDeep } from 'lodash'

import { getMCPToolData } from '../mcp'
import { codebuffToolHandlers } from './handlers/list'
import {
  parseRawToolCall as parseRawToolCallImpl,
  parseRawCustomToolCall as parseRawCustomToolCallImpl,
  tryTransformAgentToolCall as tryTransformAgentToolCallImpl,
} from './parsers'

import type { CustomToolCall, ToolCallError, ExecuteToolCallParams } from './types'
import type { CodebuffToolHandlerFunction } from './handlers/handler-function-type'
import type { ToolName } from '@codebuff/common/tools/constants'
import type {
  ClientToolCall,
  ClientToolName,
  CodebuffToolCall,
  CodebuffToolOutput,
} from '@codebuff/common/tools/list'
import type { ToolMessage } from '@codebuff/common/types/messages/codebuff-message'
import type { ToolResultOutput } from '@codebuff/common/types/messages/content-part'

// Re-export types for backward compatibility
export type { CustomToolCall, ToolCallError, ExecuteToolCallParams } from './types'

// Re-export parsing functions for backward compatibility
export const parseRawToolCall = parseRawToolCallImpl
export const parseRawCustomToolCall = parseRawCustomToolCallImpl
export const tryTransformAgentToolCall = tryTransformAgentToolCallImpl

export function executeToolCall<T extends ToolName>(
  params: ExecuteToolCallParams<T>,
): Promise<void> {
  const {
    toolName,
    input,
    excludeToolFromMessageHistory = false,
    fromHandleSteps = false,

    agentState,
    agentTemplate,
    logger,
    previousToolCallFinished,
    toolCalls,
    toolResults,
    toolResultsToAddAfterStream,
    userInputId,

    onCostCalculated,
    onResponseChunk,
    requestToolCall,
  } = params
  const toolCallId = params.toolCallId ?? generateCompactId()

  const toolCall: CodebuffToolCall<T> | ToolCallError = parseRawToolCall<T>({
    rawToolCall: {
      toolName,
      toolCallId,
      input,
    },
  })

  // Filter out restricted tools - emit error instead of tool call/result
  // This prevents the CLI from showing tool calls that the agent doesn't have permission to use
  if (
    toolCall.toolName &&
    !agentTemplate.toolNames.includes(toolCall.toolName) &&
    !fromHandleSteps
  ) {
    // Emit an error event instead of tool call/result pair
    // The stream parser will convert this to a user message for proper API compliance
    onResponseChunk({
      type: 'error',
      message: `Tool \`${toolName}\` is not currently available. Make sure to only use tools provided at the start of the conversation AND that you most recently have permission to use.`,
    })
    return previousToolCallFinished
  }

  if ('error' in toolCall) {
    onResponseChunk({
      type: 'error',
      message: toolCall.error,
    })
    logger.debug(
      { toolCall, error: toolCall.error },
      `${toolName} error: ${toolCall.error}`,
    )
    return previousToolCallFinished
  }

  // Only emit tool_call event after permission check passes
  onResponseChunk({
    type: 'tool_call',
    toolCallId,
    toolName,
    input,
    agentId: agentState.agentId,
    parentAgentId: agentState.parentId,
    includeToolCall: !excludeToolFromMessageHistory,
  })

  toolCalls.push(toolCall)

  // Cast to any to avoid type errors
  const handler = codebuffToolHandlers[
    toolName
  ] as unknown as CodebuffToolHandlerFunction<T>
  const toolResultPromise = handler({
    ...params,
    previousToolCallFinished,
    writeToClient: onResponseChunk,
    requestClientToolCall: (async (
      clientToolCall: ClientToolCall<T extends ClientToolName ? T : never>,
    ) => {
      if (params.signal.aborted) {
        return []
      }

      const clientToolResult = await requestToolCall({
        userInputId,
        toolName: clientToolCall.toolName,
        input: clientToolCall.input,
      })
      return clientToolResult.output as CodebuffToolOutput<T>
    }) as any,
    toolCall,
  })

  return toolResultPromise.then(async ({ output, creditsUsed }) => {
    const toolResult: ToolMessage = {
      role: 'tool',
      toolName,
      toolCallId: toolCall.toolCallId,
      content: output,
    }
    logger.debug(
      { input, toolResult },
      `${toolName} tool call & result (${toolResult.toolCallId})`,
    )

    onResponseChunk({
      type: 'tool_result',
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      output: toolResult.content,
    })

    toolResults.push(toolResult)

    if (!excludeToolFromMessageHistory && !params.skipDirectResultPush) {
      agentState.messageHistory.push(toolResult)
    }

    // After tool completes, resolve any pending creditsUsed promise
    if (creditsUsed) {
      onCostCalculated(creditsUsed)
      logger.debug(
        { credits: creditsUsed, totalCredits: agentState.creditsUsed },
        `Added ${creditsUsed} credits from ${toolName} to agent state`,
      )
    }
  })
}

export async function executeCustomToolCall(
  params: ExecuteToolCallParams<string>,
): Promise<void> {
  const {
    toolName,
    input,
    autoInsertEndStepParam = false,
    excludeToolFromMessageHistory = false,
    fromHandleSteps = false,

    agentState,
    agentTemplate,
    fileContext,
    logger,
    onResponseChunk,
    previousToolCallFinished,
    requestToolCall,
    toolCallId,
    toolCalls,
    toolResults,
    toolResultsToAddAfterStream,
    userInputId,
  } = params
  const toolCall: CustomToolCall | ToolCallError = parseRawCustomToolCall({
    customToolDefs: await getMCPToolData({
      ...params,
      toolNames: agentTemplate.toolNames,
      mcpServers: agentTemplate.mcpServers,
      writeTo: cloneDeep(fileContext.customToolDefinitions),
    }),
    rawToolCall: {
      toolName,
      toolCallId: toolCallId ?? generateCompactId(),
      input,
    },
    autoInsertEndStepParam,
  })

  // Filter out restricted tools - emit error instead of tool call/result
  // This prevents the CLI from showing tool calls that the agent doesn't have permission to use
  if (
    toolCall.toolName &&
    !(agentTemplate.toolNames as string[]).includes(toolCall.toolName) &&
    !fromHandleSteps &&
    !(
      toolCall.toolName.includes('/') &&
      toolCall.toolName.split('/')[0] in agentTemplate.mcpServers
    )
  ) {
    // Emit an error event instead of tool call/result pair
    // The stream parser will convert this to a user message for proper API compliance
    onResponseChunk({
      type: 'error',
      message: `Tool \`${toolName}\` is not currently available. Make sure to only use tools listed in the system instructions.`,
    })
    return previousToolCallFinished
  }

  if ('error' in toolCall) {
    onResponseChunk({
      type: 'error',
      message: toolCall.error,
    })
    logger.debug(
      { toolCall, error: toolCall.error },
      `${toolName} error: ${toolCall.error}`,
    )
    return previousToolCallFinished
  }

  // Only emit tool_call event after permission check passes
  onResponseChunk({
    type: 'tool_call',
    toolCallId: toolCall.toolCallId,
    toolName,
    input: toolCall.input,
    // Only include agentId for subagents (agents with a parent)
    ...(agentState?.parentId && { agentId: agentState.agentId }),
    // Include includeToolCall flag if explicitly set to false
    ...(excludeToolFromMessageHistory && { includeToolCall: false }),
  })

  toolCalls.push(toolCall)

  return previousToolCallFinished
    .then(async () => {
      if (params.signal.aborted) {
        return null
      }

      const toolName = toolCall.toolName.includes('/')
        ? toolCall.toolName.split('/').slice(1).join('/')
        : toolCall.toolName
      const clientToolResult = await requestToolCall({
        userInputId,
        toolName,
        input: toolCall.input,
        mcpConfig: toolCall.toolName.includes('/')
          ? agentTemplate.mcpServers[toolCall.toolName.split('/')[0]]
          : undefined,
      })
      return clientToolResult.output satisfies ToolResultOutput[]
    })
    .then((result) => {
      if (result === null) {
        return
      }
      const toolResult = {
        role: 'tool',
        toolName,
        toolCallId: toolCall.toolCallId,
        content: result,
      } satisfies ToolMessage
      logger.debug(
        { input, toolResult },
        `${toolName} custom tool call & result (${toolResult.toolCallId})`,
      )
      if (result === undefined) {
        return
      }

      onResponseChunk({
        type: 'tool_result',
        toolName: toolResult.toolName,
        toolCallId: toolResult.toolCallId,
        output: toolResult.content,
      })

      toolResults.push(toolResult)

      if (!excludeToolFromMessageHistory && !params.skipDirectResultPush) {
        agentState.messageHistory.push(toolResult)
      }
      return
    })
}


