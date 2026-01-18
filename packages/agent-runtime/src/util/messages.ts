/**
 * Message utilities module
 *
 * Re-exports from focused sub-modules:
 * - message-builders: Message construction utilities
 * - message-filters: Message filtering and expiration
 * - message-extractors: Content extraction from messages
 * - message-truncation: Token-aware message truncation
 */

// Message builders
export {
  messagesWithSystem,
  asUserMessage,
  parseUserMessage,
  withSystemInstructionTags,
  withSystemTags,
  buildUserMessageContent,
  getCancelledAdditionalMessages,
  castAssistantMessage,
} from './message-builders'

// Message filters
export {
  expireMessages,
  filterUnfinishedToolCalls,
} from './message-filters'

// Message extractors
export {
  getEditedFiles,
  getPreviouslyReadFiles,
} from './message-extractors'

// Message truncation
export {
  trimMessagesToFitTokenLimit,
  getMessagesSubset,
} from './message-truncation'
