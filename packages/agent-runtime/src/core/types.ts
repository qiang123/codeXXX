/**
 * Core types for agent execution
 */

import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { TrackEventFn } from '@codebuff/common/types/contracts/analytics'
import type {
  AddAgentStepFn,
  FinishAgentRunFn,
  StartAgentRunFn,
} from '@codebuff/common/types/contracts/database'
import type { PromptAiSdkFn } from '@codebuff/common/types/contracts/llm'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'
import type { PrintModeEvent } from '@codebuff/common/types/print-mode'
import type {
  AgentTemplateType,
  AgentState,
  AgentOutput,
} from '@codebuff/common/types/session-state'
import type { ProjectFileContext } from '@codebuff/common/util/file'
import type { ToolSet } from 'ai'

/**
 * Result of a single agent step execution
 */
export interface AgentStepResult {
  agentState: AgentState
  fullResponse: string
  shouldEndTurn: boolean
  messageId: string | null
  nResponses?: string[]
}

/**
 * Result of the agent loop execution
 */
export interface AgentLoopResult {
  agentState: AgentState
  output: AgentOutput
}

/**
 * Common parameters shared across agent execution functions
 */
export interface AgentExecutionContext {
  userId: string | undefined
  userInputId: string
  clientSessionId: string
  fingerprintId: string
  repoId: string | undefined
  repoUrl: string | undefined
  runId: string
  signal: AbortSignal
  logger: Logger
  trackEvent: TrackEventFn
}

/**
 * Agent configuration for a step
 */
export interface AgentStepConfig {
  agentType: AgentTemplateType
  agentTemplate: AgentTemplate
  fileContext: ProjectFileContext
  agentState: AgentState
  localAgentTemplates: Record<string, AgentTemplate>
  system: string
  tools: ToolSet
}

/**
 * Step execution callbacks
 */
export interface AgentStepCallbacks {
  onResponseChunk: (chunk: string | PrintModeEvent) => void
  onCostCalculated: (credits: number) => Promise<void>
}
