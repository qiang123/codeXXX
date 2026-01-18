/**
 * Message content extraction utilities
 */

import { buildArray } from '@codebuff/common/util/array'
import { getErrorObject } from '@codebuff/common/util/error'

import type { CodebuffToolMessage } from '@codebuff/common/tools/list'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'

/**
 * Extracts file paths that were edited in the message history
 */
export function getEditedFiles(params: {
  messages: Message[]
  logger: Logger
}): string[] {
  const { messages, logger } = params
  return buildArray(
    messages
      .filter(
        (
          m,
        ): m is CodebuffToolMessage<
          'create_plan' | 'str_replace' | 'write_file'
        > => {
          return (
            m.role === 'tool' &&
            (m.toolName === 'create_plan' ||
              m.toolName === 'str_replace' ||
              m.toolName === 'write_file')
          )
        },
      )
      .map((m) => {
        try {
          const fileInfo = m.content[0].value
          if ('errorMessage' in fileInfo) {
            return null
          }
          return fileInfo.file
        } catch (error) {
          logger.error(
            { error: getErrorObject(error), m },
            'Error parsing file info',
          )
          return null
        }
      }),
  )
}

/**
 * Extracts files that were previously read in the message history
 */
export function getPreviouslyReadFiles(params: {
  messages: Message[]
  logger: Logger
}): {
  path: string
  content: string
  referencedBy?: Record<string, string[]>
}[] {
  const { messages, logger } = params
  const files: ReturnType<typeof getPreviouslyReadFiles> = []
  for (const message of messages) {
    if (message.role !== 'tool') continue
    if (message.toolName === 'read_files') {
      try {
        files.push(
          ...(
            message as CodebuffToolMessage<'read_files'>
          ).content[0].value.filter(
            (
              file,
            ): file is typeof file & { contentOmittedForLength: undefined } =>
              !('contentOmittedForLength' in file),
          ),
        )
      } catch (error) {
        logger.error(
          { error: getErrorObject(error), message },
          'Error parsing read_files output from message',
        )
      }
    }

    if (message.toolName === 'find_files') {
      try {
        const v = (message as CodebuffToolMessage<'find_files'>).content[0]
          .value
        if ('message' in v) {
          continue
        }
        files.push(
          ...v.filter(
            (
              file,
            ): file is typeof file & { contentOmittedForLength: undefined } =>
              !('contentOmittedForLength' in file),
          ),
        )
      } catch (error) {
        logger.error(
          { error: getErrorObject(error), message },
          'Error parsing find_files output from message',
        )
      }
    }
  }
  return files
}
