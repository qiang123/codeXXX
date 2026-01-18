/**
 * Tool call parsing utilities
 */

import { endsAgentStepParam } from '@codebuff/common/tools/constants'
import { toolParams } from '@codebuff/common/tools/list'

import { getAgentShortName } from '../templates/prompts'
import { ensureZodSchema } from './prompts'

import type { CustomToolCall, ToolCallError } from './types'
import type { ToolName } from '@codebuff/common/tools/constants'
import type { CodebuffToolCall } from '@codebuff/common/tools/list'
import type { AgentTemplateType } from '@codebuff/common/types/session-state'
import type { CustomToolDefinitions } from '@codebuff/common/util/file'

/**
 * Parses and validates a raw tool call for native Codebuff tools
 */
export function parseRawToolCall<T extends ToolName = ToolName>(params: {
  rawToolCall: {
    toolName: T
    toolCallId: string
    input: Record<string, unknown>
  }
}): CodebuffToolCall<T> | ToolCallError {
  const { rawToolCall } = params
  const toolName = rawToolCall.toolName

  const processedParameters = rawToolCall.input
  const paramsSchema = toolParams[toolName].inputSchema

  const result = paramsSchema.safeParse(processedParameters)

  if (!result.success) {
    return {
      toolName,
      toolCallId: rawToolCall.toolCallId,
      input: rawToolCall.input,
      error: `Invalid parameters for ${toolName}: ${JSON.stringify(
        result.error.issues,
        null,
        2,
      )}`,
    }
  }

  if (endsAgentStepParam in result.data) {
    delete result.data[endsAgentStepParam]
  }

  return {
    toolName,
    input: result.data,
    toolCallId: rawToolCall.toolCallId,
  } as CodebuffToolCall<T>
}

/**
 * Parses and validates a raw tool call for custom/MCP tools
 */
export function parseRawCustomToolCall(params: {
  customToolDefs: CustomToolDefinitions
  rawToolCall: {
    toolName: string
    toolCallId: string
    input: Record<string, unknown>
  }
  autoInsertEndStepParam?: boolean
}): CustomToolCall | ToolCallError {
  const { customToolDefs, rawToolCall, autoInsertEndStepParam = false } = params
  const toolName = rawToolCall.toolName

  if (
    !(customToolDefs && toolName in customToolDefs) &&
    !toolName.includes('/')
  ) {
    return {
      toolName,
      toolCallId: rawToolCall.toolCallId,
      input: rawToolCall.input,
      error: `Tool ${toolName} not found`,
    }
  }

  const processedParameters: Record<string, any> = {}
  for (const [param, val] of Object.entries(rawToolCall.input ?? {})) {
    processedParameters[param] = val
  }

  // Add the required codebuff_end_step parameter with the correct value for this tool if requested
  if (autoInsertEndStepParam) {
    processedParameters[endsAgentStepParam] =
      customToolDefs?.[toolName]?.endsAgentStep
  }

  const rawSchema = customToolDefs?.[toolName]?.inputSchema
  if (rawSchema) {
    const paramsSchema = ensureZodSchema(rawSchema)
    const result = paramsSchema.safeParse(processedParameters)

    if (!result.success) {
      return {
        toolName: toolName,
        toolCallId: rawToolCall.toolCallId,
        input: rawToolCall.input,
        error: `Invalid parameters for ${toolName}: ${JSON.stringify(
          result.error.issues,
          null,
          2,
        )}`,
      }
    }
  }

  const input = JSON.parse(JSON.stringify(rawToolCall.input))
  if (endsAgentStepParam in input) {
    delete input[endsAgentStepParam]
  }
  return {
    toolName: toolName,
    input,
    toolCallId: rawToolCall.toolCallId,
  }
}

/**
 * Checks if a tool name matches a spawnable agent and returns the transformed
 * spawn_agents input if so. Returns null if not an agent tool call.
 */
export function tryTransformAgentToolCall(params: {
  toolName: string
  input: Record<string, unknown>
  spawnableAgents: AgentTemplateType[]
}): { toolName: 'spawn_agents'; input: Record<string, unknown> } | null {
  const { toolName, input, spawnableAgents } = params

  const agentShortNames = spawnableAgents.map(getAgentShortName)
  if (!agentShortNames.includes(toolName)) {
    return null
  }

  // Find the full agent type for this short name
  const fullAgentType = spawnableAgents.find(
    (agentType) => getAgentShortName(agentType) === toolName,
  )

  // Convert to spawn_agents call - input already has prompt and params as top-level fields
  // (consistent with spawn_agents schema)
  const agentEntry: Record<string, unknown> = {
    agent_type: fullAgentType || toolName,
  }
  if (typeof input.prompt === 'string') {
    agentEntry.prompt = input.prompt
  }
  if (input.params && typeof input.params === 'object') {
    agentEntry.params = input.params
  }
  const spawnAgentsInput = {
    agents: [agentEntry],
  }

  return { toolName: 'spawn_agents', input: spawnAgentsInput }
}
