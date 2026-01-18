/**
 * XML stream parser - re-exports from util/stream-xml-parser
 */

export {
  createStreamParserState,
  parseStreamChunk,
} from '../util/stream-xml-parser'

export type {
  StreamParserState,
  ParsedToolCall,
  ParseResult,
} from '../util/stream-xml-parser'
