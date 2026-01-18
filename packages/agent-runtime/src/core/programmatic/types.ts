/**
 * Types for programmatic step execution
 */

import type { ToolResultOutput } from '@codebuff/common/types/messages/content-part'
import type { AgentState } from '@codebuff/common/types/session-state'

/**
 * Represents a tool call to be executed.
 * Can optionally include `includeToolCall: false` to exclude from message history.
 */
export type ToolCallToExecute = {
  toolName: string
  input: Record<string, unknown>
  includeToolCall?: boolean
}

/**
 * Result of running a programmatic step
 */
export type ProgrammaticStepResult = {
  agentState: AgentState
  endTurn: boolean
  stepNumber: number
  generateN?: number
}

/**
 * Tool execution result
 */
export type ToolExecutionResult = ToolResultOutput[] | undefined
