/**
 * Message truncation utilities for token management
 */

import { AssertionError } from 'assert'

import { userMessage } from '@codebuff/common/util/messages'
import { cloneDeep, isEqual } from 'lodash'

import { simplifyTerminalCommandResults } from './simplify-tool-results'
import { countTokensJson } from './token-counter'
import { withSystemTags } from './message-builders'

import type {
  CodebuffToolMessage,
  CodebuffToolOutput,
} from '@codebuff/common/tools/list'
import type { Logger } from '@codebuff/common/types/contracts/logger'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'

// Number of terminal command outputs to keep in full form before simplifying
const numTerminalCommandsToKeep = 5

// Factor to reduce token count target by, to leave room for new messages
const shortenedMessageTokenFactor = 0.5

const replacementMessage = userMessage(
  withSystemTags('Previous message(s) omitted due to length'),
)

function simplifyTerminalHelper(params: {
  toolResult: CodebuffToolOutput<'run_terminal_command'>
  numKept: number
  logger: Logger
}): { result: CodebuffToolOutput<'run_terminal_command'>; numKept: number } {
  const { toolResult, numKept, logger } = params
  const simplified = simplifyTerminalCommandResults({
    messageContent: toolResult,
    logger,
  })

  // Keep the full output for the N most recent commands
  if (numKept < numTerminalCommandsToKeep && !isEqual(simplified, toolResult)) {
    return { result: toolResult, numKept: numKept + 1 }
  }

  return {
    result: simplified,
    numKept,
  }
}

/**
 * Trims messages from the beginning to fit within token limits while preserving
 * important content. Also simplifies terminal command outputs to save tokens.
 *
 * The function:
 * 1. Processes messages from newest to oldest
 * 2. Simplifies terminal command outputs after keeping N most recent ones
 * 3. Stops adding messages when approaching token limit
 */
export function trimMessagesToFitTokenLimit(params: {
  messages: Message[]
  systemTokens: number
  maxTotalTokens?: number
  logger: Logger
}): Message[] {
  const { messages, systemTokens, maxTotalTokens = 190_000, logger } = params
  const maxMessageTokens = maxTotalTokens - systemTokens

  // Check if we're already under the limit
  const initialTokens = countTokensJson(messages)

  if (initialTokens < maxMessageTokens) {
    return messages
  }

  const shortenedMessages: Message[] = []
  let numKept = 0

  // Process messages from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
      shortenedMessages.push(m)
    } else if (m.role === 'tool') {
      if (m.toolName !== 'run_terminal_command') {
        shortenedMessages.push(m)
        continue
      }

      const terminalResultMessage = cloneDeep(
        m,
      ) as CodebuffToolMessage<'run_terminal_command'>

      const result = simplifyTerminalHelper({
        toolResult: terminalResultMessage.content,
        numKept,
        logger,
      })
      terminalResultMessage.content = result.result
      numKept = result.numKept

      shortenedMessages.push(terminalResultMessage)
    } else {
      m satisfies never
      const mAny = m as any
      throw new AssertionError({ message: `Not a valid role: ${mAny.role}` })
    }
  }
  shortenedMessages.reverse()

  const requiredTokens = countTokensJson(
    shortenedMessages.filter((m) => m.keepDuringTruncation),
  )
  let removedTokens = 0
  const tokensToRemove =
    (maxMessageTokens - requiredTokens) * (1 - shortenedMessageTokenFactor)

  const placeholder = 'deleted'
  const filteredMessages: (Message | typeof placeholder)[] = []
  for (const message of shortenedMessages) {
    if (removedTokens >= tokensToRemove || message.keepDuringTruncation) {
      filteredMessages.push(message)
      continue
    }
    removedTokens += countTokensJson(message)
    if (
      filteredMessages.length === 0 ||
      filteredMessages[filteredMessages.length - 1] !== placeholder
    ) {
      filteredMessages.push(placeholder)
      removedTokens -= countTokensJson(replacementMessage)
    }
  }

  return filteredMessages.map((m) =>
    m === placeholder ? replacementMessage : m,
  )
}

/**
 * Gets a subset of messages that fits within token limits
 */
export function getMessagesSubset(params: {
  messages: Message[]
  otherTokens: number
  logger: Logger
}): Message[] {
  const { messages, otherTokens, logger } = params
  const messagesSubset = trimMessagesToFitTokenLimit({
    messages,
    systemTokens: otherTokens,
    logger,
  })

  // Remove cache_control from all messages
  for (const message of messagesSubset) {
    for (const provider of ['anthropic', 'openrouter', 'codebuff'] as const) {
      delete message.providerOptions?.[provider]?.cacheControl
    }
  }

  // Cache up to the last message!
  const lastMessage = messagesSubset[messagesSubset.length - 1]
  if (!lastMessage) {
    logger.debug(
      {
        messages,
        messagesSubset,
        otherTokens,
      },
      'No last message found in messagesSubset!',
    )
  }

  return messagesSubset
}
