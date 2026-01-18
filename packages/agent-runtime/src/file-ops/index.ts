/**
 * File Operations Module
 *
 * Provides unified file operation functionality:
 * - types: Type definitions for file operations
 * - rewrite: Fast file rewrite using LLM
 * - process-block: Process file blocks with diff generation
 * - str-replace: String replacement operations
 * - diff: Diff generation and parsing utilities
 */

// Types
export type {
  WriteFileSuccess,
  WriteFileError,
  WriteFileResult,
  StrReplaceSuccess,
  StrReplaceError,
  StrReplaceResult,
  Replacement,
} from './types'

// Fast rewrite
export {
  fastRewrite,
  rewriteWithOpenAI,
  shouldAddFilePlaceholders,
} from './rewrite'

// Process file block
export { processFileBlock, handleLargeFile } from './process-block'

// String replace
export { processStrReplace } from './str-replace'

// Diff utilities
export {
  parseAndGetDiffBlocksSingleFile,
  tryToDoStringReplacementWithExtraIndentation,
  retryDiffBlocksPrompt,
} from './diff'
