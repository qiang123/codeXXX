/**
 * Message building utilities
 */

import { buildArray } from '@codebuff/common/util/array'
import { systemMessage, userMessage } from '@codebuff/common/util/messages'
import { closeXml } from '@codebuff/common/util/xml'

import type { System } from '../llm-api/claude'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'

/**
 * Wraps messages with a system message
 */
export function messagesWithSystem(params: {
  messages: Message[]
  system: System
}): Message[] {
  const { messages, system } = params
  return [systemMessage(system), ...messages]
}

/**
 * Wraps a string in user_message XML tags
 */
export function asUserMessage(str: string): string {
  return `<user_message>${str}${closeXml('user_message')}`
}

/**
 * Parses a user message from XML tags
 */
export function parseUserMessage(str: string): string | undefined {
  const match = str.match(/<user_message>(.*?)<\/user_message>/s)
  return match ? match[1] : undefined
}

/**
 * Wraps content in system_instructions XML tags
 */
export function withSystemInstructionTags(str: string): string {
  return `<system_instructions>${str}${closeXml('system_instructions')}`
}

/**
 * Wraps content in system XML tags
 */
export function withSystemTags(str: string): string {
  return `<system>${str}${closeXml('system')}`
}

/**
 * Combines prompt, params, and content into a unified message content structure.
 * Always wraps the first text part in <user_message> tags for consistent XML framing.
 */
export function buildUserMessageContent(
  prompt: string | undefined,
  params: Record<string, any> | undefined,
  content?: Array<TextPart | ImagePart>,
): Array<TextPart | ImagePart> {
  const promptHasNonWhitespaceText = (prompt ?? '').trim().length > 0

  // If we have content array (e.g., text + images)
  if (content && content.length > 0) {
    // Check if content has a non-empty text part
    const firstTextPart = content.find((p): p is TextPart => p.type === 'text')
    const hasNonEmptyText = firstTextPart && firstTextPart.text.trim()

    // If content has no meaningful text but prompt is provided, prepend prompt
    if (!hasNonEmptyText && promptHasNonWhitespaceText) {
      const nonTextContent = content.filter((p) => p.type !== 'text')
      return [
        { type: 'text' as const, text: asUserMessage(prompt!) },
        ...nonTextContent,
      ]
    }

    // Find the first text part and wrap it in <user_message> tags
    let hasWrappedText = false
    const wrappedContent = content.map((part) => {
      if (part.type === 'text' && !hasWrappedText) {
        hasWrappedText = true
        // Check if already wrapped
        const alreadyWrapped = parseUserMessage(part.text) !== undefined
        if (alreadyWrapped) {
          return part
        }
        return {
          type: 'text' as const,
          text: asUserMessage(part.text),
        }
      }
      return part
    })
    return wrappedContent
  }

  // Only prompt/params, combine and return as simple text
  const textParts = buildArray([
    promptHasNonWhitespaceText ? prompt : undefined,
    params && JSON.stringify(params, null, 2),
  ])
  return [
    {
      type: 'text',
      text: asUserMessage(textParts.join('\n\n')),
    },
  ]
}

/**
 * Creates messages for a cancelled operation
 */
export function getCancelledAdditionalMessages(args: {
  prompt: string | undefined
  params: Record<string, any> | undefined
  content?: Array<TextPart | ImagePart>
  pendingAgentResponse: string
  systemMessage: string
}): Message[] {
  const { prompt, params, content, pendingAgentResponse, systemMessage } = args

  const messages: Message[] = [
    {
      role: 'user',
      content: buildUserMessageContent(prompt, params, content),
      tags: ['USER_PROMPT'],
    },
    userMessage(
      `<previous_assistant_message>${pendingAgentResponse}</previous_assistant_message>\n\n${withSystemTags(systemMessage)}`,
    ),
  ]

  return messages
}

/**
 * Casts an assistant message to a user message format
 */
export function castAssistantMessage(message: Message): Message | null {
  if (message.role !== 'assistant') {
    return message
  }
  if (typeof message.content === 'string') {
    return userMessage(
      `<previous_assistant_message>${message.content}${closeXml('previous_assistant_message')}`,
    )
  }
  const content = buildArray(
    message.content.map((m) => {
      if (m.type === 'text') {
        return {
          ...m,
          text: `<previous_assistant_message>${m.text}${closeXml('previous_assistant_message')}`,
        }
      }
      return null
    }),
  )
  return content
    ? {
        role: 'user' as const,
        content,
      }
    : null
}
