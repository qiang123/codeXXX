/**
 * Stream processing module
 *
 * Provides unified stream parsing and processing functionality:
 * - types: Type definitions for stream processing
 * - xml-parser: XML tag parsing from text streams
 * - tool-parser: Tool call extraction from LLM streams
 * - processor: Main stream processor with tool execution
 */

// Types
export type {
  ToolCallProcessor,
  StreamProcessorConfig,
  XmlToolCallExecutor,
  StreamProcessResult,
} from './types'

// XML parsing
export {
  createStreamParserState,
  parseStreamChunk,
} from './xml-parser'

export type {
  StreamParserState,
  ParsedToolCall,
  ParseResult,
} from './xml-parser'

// Tool parsing
export { processStreamWithTools } from './tool-parser'

// Main processor
export { processStream } from './processor'
