/**
 * Agent Runtime Package
 *
 * Modular architecture for agent execution:
 * - core/      - Agent execution loop and step handling
 * - stream/    - Stream parsing and processing
 * - file-ops/  - File operations (rewrite, replace, diff)
 * - tools/     - Tool handlers and execution
 * - templates/ - Agent template management
 * - llm-api/   - LLM API integrations
 * - util/      - Utility functions
 */

// Core execution
export * from './core'

// Stream processing
export * from './stream'

// File operations
export * from './file-ops'

// Main entry points (legacy exports for backward compatibility)
export { mainPrompt, callMainPrompt } from './main-prompt'
export { getAgentStreamFromTemplate } from './prompt-agent-stream'

// Templates
export { getAgentTemplate, assembleLocalAgentTemplates, clearDatabaseCache } from './templates/agent-registry'
export type { AgentTemplate, StepGenerator, StepHandler, PlaceholderValue } from './templates/types'
export { PLACEHOLDER, placeholderValues, baseAgentToolNames, baseAgentSubagents } from './templates/types'

// Tools
export { getToolSet, getToolsInstructions, buildToolDescription, fullToolList, getShortToolInstructions } from './tools/prompts'
export { executeToolCall, executeCustomToolCall, parseRawToolCall, parseRawCustomToolCall, tryTransformAgentToolCall } from './tools/tool-executor'
export type { ExecuteToolCallParams, CustomToolCall, ToolCallError } from './tools/tool-executor'
export { codebuffToolHandlers } from './tools/handlers/list'

// Utilities
export * from './util/messages'
export { countTokens, countTokensJson, countTokensForFiles } from './util/token-counter'
export { renderReadFilesResult } from './util/render-read-files-result'
export { simplifyReadFileResults, simplifyTerminalCommandResults } from './util/simplify-tool-results'
export { getAgentOutput } from './util/agent-output'
export { parseToolCallsFromText, parseTextWithToolCalls } from './util/parse-tool-calls-from-text'

// LLM APIs
export { callWebSearchAPI, callDocsSearchAPI, callTokenCountAPI } from './llm-api/codebuff-web-api'
export { searchLibraries, fetchContext7LibraryDocumentation } from './llm-api/context7-api'
export { searchWeb } from './llm-api/linkup-api'
export { promptRelaceAI } from './llm-api/relace-api'
export { promptFlashWithFallbacks } from './llm-api/gemini-with-fallbacks'
export type { System, TextBlock } from './llm-api/claude'

// MCP
export { getMCPToolData } from './mcp'

// File reading updates (not in file-ops module)
export { getFileReadingUpdates } from './get-file-reading-updates'

// Find files
export { requestRelevantFiles, requestRelevantFilesForTraining } from './find-files/request-files-prompt'
export { CustomFilePickerConfigSchema } from './find-files/custom-file-picker-config'
export type { CustomFilePickerConfig } from './find-files/custom-file-picker-config'

// Constants
export { globalStopSequence } from './constants'
