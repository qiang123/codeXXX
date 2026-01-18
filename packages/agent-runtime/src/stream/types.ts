/**
 * Types for stream processing
 */

import type { Model } from '@codebuff/common/old-constants'
import type { StreamChunk } from '@codebuff/common/types/contracts/llm'
import type { PrintModeError, PrintModeText } from '@codebuff/common/types/print-mode'

/**
 * Tool call processor interface
 */
export type ToolCallProcessor = {
  onTagStart: (tagName: string, attributes: Record<string, string>) => void
  onTagEnd: (tagName: string, params: Record<string, any>) => void
}

/**
 * Stream processor configuration
 */
export type StreamProcessorConfig = {
  processors: Record<string, ToolCallProcessor>
  defaultProcessor: (toolName: string) => ToolCallProcessor
  onError: (tagName: string, errorMessage: string) => void
  onResponseChunk: (chunk: PrintModeText | PrintModeError) => void
  loggerOptions?: {
    userId?: string
    model?: Model
    agentName?: string
  }
}

/**
 * XML tool call execution callback
 */
export type XmlToolCallExecutor = (params: {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}) => Promise<void>

/**
 * Stream processing result
 */
export type StreamProcessResult = {
  fullResponse: string
  fullResponseChunks: string[]
  hadToolCallError: boolean
  messageId: string | null
  toolCalls: any[]
  toolResults: any[]
}
