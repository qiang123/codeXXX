/**
 * Tool definitions helper for agent execution
 */

import { cloneDeep } from 'lodash'

import { getMCPToolData } from '../mcp'

import type { AgentTemplate } from '@codebuff/common/types/agent-template'
import type { ParamsExcluding } from '@codebuff/common/types/function-params'
import type {
  CustomToolDefinitions,
  ProjectFileContext,
} from '@codebuff/common/util/file'

/**
 * Builds additional tool definitions from custom tools and MCP servers
 */
export async function buildAdditionalToolDefinitions(
  params: {
    agentTemplate: AgentTemplate
    fileContext: ProjectFileContext
  } & ParamsExcluding<
    typeof getMCPToolData,
    'toolNames' | 'mcpServers' | 'writeTo'
  >,
): Promise<CustomToolDefinitions> {
  const { agentTemplate, fileContext } = params

  const defs = cloneDeep(
    Object.fromEntries(
      Object.entries(fileContext.customToolDefinitions).filter(([toolName]) =>
        agentTemplate!.toolNames.includes(toolName),
      ),
    ),
  )
  return getMCPToolData({
    ...params,
    toolNames: agentTemplate!.toolNames,
    mcpServers: agentTemplate!.mcpServers,
    writeTo: defs,
  })
}

/**
 * Creates a cached version of the additional tool definitions function
 */
export function createCachedToolDefinitions(
  params: Parameters<typeof buildAdditionalToolDefinitions>[0],
): () => Promise<CustomToolDefinitions> {
  let cached: CustomToolDefinitions | undefined

  return async () => {
    if (!cached) {
      cached = await buildAdditionalToolDefinitions(params)
    }
    return cached
  }
}
