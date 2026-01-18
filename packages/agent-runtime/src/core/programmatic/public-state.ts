/**
 * Public agent state utilities
 */

import type {
  PublicAgentState,
} from '@codebuff/common/types/agent-template'
import type { AgentState } from '@codebuff/common/types/session-state'

/**
 * Extracts public-facing agent state from full agent state
 */
export const getPublicAgentState = (
  agentState: AgentState & Required<Pick<AgentState, 'runId'>>,
): PublicAgentState => {
  const {
    agentId,
    runId,
    parentId,
    messageHistory,
    output,
    systemPrompt,
    toolDefinitions,
    contextTokenCount,
  } = agentState
  return {
    agentId,
    runId,
    parentId,
    messageHistory: messageHistory as any as PublicAgentState['messageHistory'],
    output,
    systemPrompt,
    toolDefinitions,
    contextTokenCount,
  }
}
