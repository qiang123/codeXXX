/**
 * Tools module - tool execution and parsing
 *
 * Sub-modules:
 * - types: Type definitions for tool execution
 * - parsers: Tool call parsing utilities
 * - tool-executor: Native and custom tool execution
 * - stream-parser: Stream processing for tool calls
 * - prompts: Tool set building and descriptions
 * - handlers/: Individual tool handler implementations
 */

// Types
export * from './types'

// Parsers
export * from './parsers'

// Execution
export {
  executeToolCall,
  executeCustomToolCall,
} from './tool-executor'

// Re-export for backward compatibility
export {
  parseRawToolCall,
  parseRawCustomToolCall,
  tryTransformAgentToolCall,
} from './tool-executor'

// Stream processing
export { processStream } from './stream-parser'

// Prompts and tool set building
export {
  ensureZodSchema,
  buildToolDescription,
  toolDescriptions,
  getToolsInstructions,
  fullToolList,
  getShortToolInstructions,
  getToolSet,
} from './prompts'

// Handler list
export { codebuffToolHandlers } from './handlers/list'
