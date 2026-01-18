/**
 * Types for file operations
 */

/**
 * Result of a successful file write operation
 */
export type WriteFileSuccess = {
  tool: 'write_file'
  path: string
  content: string
  patch: string | undefined
  messages: string[]
}

/**
 * Result of a failed file write operation
 */
export type WriteFileError = {
  tool: 'write_file'
  path: string
  error: string
}

/**
 * Result of a file write operation
 */
export type WriteFileResult = WriteFileSuccess | WriteFileError

/**
 * Result of a successful string replace operation
 */
export type StrReplaceSuccess = {
  tool: 'str_replace'
  path: string
  content: string
  patch: string
  messages: string[]
}

/**
 * Result of a failed string replace operation
 */
export type StrReplaceError = {
  tool: 'str_replace'
  path: string
  error: string
}

/**
 * Result of a string replace operation
 */
export type StrReplaceResult = StrReplaceSuccess | StrReplaceError

/**
 * Replacement specification for str_replace
 */
export type Replacement = {
  old: string
  new: string
  allowMultiple: boolean
}
