/**
 * Helper functions for the agent loop execution
 */

import { buildArray } from '@codebuff/common/util/array'
import { userMessage } from '@codebuff/common/util/messages'
import { mapValues } from 'lodash'

import { additionalSystemPrompts } from '../system-prompt/prompts'
import {
  withSystemInstructionTags,
  buildUserMessageContent,
} from '../util/messages'

import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type {
  TextPart,
  ImagePart,
} from '@codebuff/common/types/messages/content-part'
import type { ToolSet } from 'ai'

/**
 * Builds the initial message history for agent execution
 */
export function buildInitialMessages(params: {
  existingMessages: Message[]
  prompt: string | undefined
  spawnParams: Record<string, any> | undefined
  content?: Array<TextPart | ImagePart>
  instructionsPrompt: string | undefined
}): Message[] {
  const { existingMessages, prompt, spawnParams, content, instructionsPrompt } = params

  const hasUserMessage = Boolean(
    prompt ||
    (spawnParams && Object.keys(spawnParams).length > 0) ||
    (content && content.length > 0),
  )

  return buildArray<Message>(
    ...existingMessages,

    hasUserMessage && [
      {
        role: 'user' as const,
        content: buildUserMessageContent(prompt, spawnParams, content),
        tags: ['USER_PROMPT'],
        sentAt: Date.now(),
        keepDuringTruncation: true,
      },
      prompt &&
        prompt in additionalSystemPrompts &&
        userMessage(
          withSystemInstructionTags(
            additionalSystemPrompts[
              prompt as keyof typeof additionalSystemPrompts
            ],
          ),
        ),
    ],

    instructionsPrompt &&
      userMessage({
        content: instructionsPrompt,
        tags: ['INSTRUCTIONS_PROMPT'],
        keepLastTags: ['INSTRUCTIONS_PROMPT'],
      }),
  )
}

/**
 * Converts tools to serializable format for token counting
 */
export function serializeToolDefinitions(tools: ToolSet): Record<string, { description: string | undefined; inputSchema: object }> {
  return mapValues(tools, (tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema as {},
  }))
}

/**
 * Checks if there is a user message to send
 */
export function hasUserMessageContent(
  prompt: string | undefined,
  spawnParams: Record<string, any> | undefined,
  content?: Array<TextPart | ImagePart>,
): boolean {
  return Boolean(
    prompt ||
    (spawnParams && Object.keys(spawnParams).length > 0) ||
    (content && content.length > 0),
  )
}
