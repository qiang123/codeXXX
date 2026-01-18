/**
 * Tool execution types
 */

import type { AgentTemplate } from '../templates/types'
import type { FileProcessingState } from './handlers/tool/write-file'
import type { ToolName } from '@codebuff/common/tools/constants'
import type { CodebuffToolCall } from '@codebuff/common/tools/list'
import type {
  AgentRuntimeDeps,
  AgentRuntimeScopedDeps,
} from '@codebuff/common/types/contracts/agent-runtime'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { ToolMessage } from '@codebuff/common/types/messages/codebuff-message'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type { AgentState, Subgoal } from '@codebuff/common/types/session-state'
import type { ProjectFileContext } from '@codebuff/common/util/file'
import type { ToolCallPart, ToolSet } from 'ai'

/**
 * Represents a custom (non-native) tool call
 */
export type CustomToolCall = {
  toolName: string
  input: Record<string, unknown>
} & Omit<ToolCallPart, 'type'>

/**
 * Represents an error during tool call parsing
 */
export type ToolCallError = {
  toolName?: string
  input: Record<string, unknown>
  error: string
} & Pick<CodebuffToolCall, 'toolCallId'>

/**
 * Parameters for executing a tool call
 */
export type ExecuteToolCallParams<T extends string = ToolName> = {
  toolName: T
  input: Record<string, unknown>
  autoInsertEndStepParam?: boolean
  excludeToolFromMessageHistory?: boolean

  agentContext: Record<string, Subgoal>
  agentState: AgentState
  agentStepId: string
  ancestorRunIds: string[]
  agentTemplate: AgentTemplate
  clientSessionId: string
  fileContext: ProjectFileContext
  fileProcessingState: FileProcessingState
  fingerprintId: string
  fromHandleSteps?: boolean
  fullResponse: string
  localAgentTemplates: Record<string, AgentTemplate>
  logger: Logger
  previousToolCallFinished: Promise<void>
  prompt: string | undefined
  repoId: string | undefined
  repoUrl: string | undefined
  runId: string
  signal: AbortSignal
  system: string
  tools: ToolSet
  toolCallId: string | undefined
  toolCalls: (CodebuffToolCall | CustomToolCall)[]
  toolResults: ToolMessage[]
  toolResultsToAddAfterStream: ToolMessage[]
  skipDirectResultPush?: boolean
  userId: string | undefined
  userInputId: string

  fetch: typeof globalThis.fetch
  onCostCalculated: (credits: number) => Promise<void>
  onResponseChunk: (chunk: string | PrintModeEvent) => void
} & AgentRuntimeDeps &
  AgentRuntimeScopedDeps
