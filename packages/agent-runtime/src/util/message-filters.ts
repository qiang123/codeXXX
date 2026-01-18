/**
 * Message filtering and expiration utilities
 */

import type { Message } from '@codebuff/common/types/messages/codebuff-message'

/**
 * Filters messages based on their time-to-live settings
 */
export function expireMessages(
  messages: Message[],
  endOf: 'agentStep' | 'userPrompt',
): Message[] {
  return messages.filter((m) => {
    // Keep messages with no timeToLive
    if (m.timeToLive === undefined) return true

    // Remove messages that have expired
    if (m.timeToLive === 'agentStep') return false
    if (m.timeToLive === 'userPrompt' && endOf === 'userPrompt') return false

    return true
  })
}

/**
 * Removes tool calls from the message history that don't have corresponding tool responses.
 * This is important when passing message history to spawned agents, as unfinished tool calls
 * will cause issues with the LLM expecting tool responses.
 */
export function filterUnfinishedToolCalls(messages: Message[]): Message[] {
  // Collect all toolCallIds that have corresponding tool responses
  const respondedToolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      respondedToolCallIds.add(message.toolCallId)
    }
  }

  // Filter messages, removing unfinished tool calls from assistant messages
  const filteredMessages: Message[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') {
      filteredMessages.push(message)
      continue
    }

    // Filter out tool-call content parts that don't have responses
    const filteredContent = message.content.filter((part) => {
      if (part.type !== 'tool-call') {
        return true
      }
      return respondedToolCallIds.has(part.toolCallId)
    })

    // Only include the assistant message if it has content after filtering
    if (filteredContent.length > 0) {
      filteredMessages.push({
        ...message,
        content: filteredContent,
      })
    }
  }

  return filteredMessages
}
