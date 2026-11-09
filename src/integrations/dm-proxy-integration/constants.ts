import { type RESTJSONErrorCodes } from 'discord.js'

export const DISCORD_ID_REGEX = /^\d{17,20}$/
export const MESSAGE_MAX_LENGTH = 2000

// Discord returns at most 100 messages per page of a channel's history.
export const HISTORY_MAX_LIMIT = 100
export const HISTORY_DEFAULT_LIMIT = 50

// `Shard#eval` has no timer of its own: it settles only when the child answers, so a shard that
// dies mid-eval, blocks its event loop, or is still spawning leaves the request hanging forever.
// The ceiling has to clear a cold send — `users.fetch` then `user.send`, each with its own 15s
// @discordjs/rest timeout, plus any rate-limit wait — or it would abort sends that would land.
// A history read makes one more call, but it is safe to retry, so it shares the same ceiling.
export const EVAL_TIMEOUT_MS = 30_000

export class ValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export interface SendDmPayload {
  userId: string
  message: string
}

export interface ErrorResponse {
  error: boolean
  delivered: boolean
  reason?: string
  code?: RESTJSONErrorCodes
  message?: string
}

export interface DmEvalFailure {
  ok: false
  code?: number
  message: string
}

export interface DmEvalSuccess {
  ok: true
  messageId: string
  channelId: string
}

export type DmEvalResult = DmEvalSuccess | DmEvalFailure

export interface DmHistoryPayload {
  userId: string
  limit: number
  before?: string
  after?: string
}

export interface DmHistoryAttachment {
  id: string
  name: string
  url: string
  contentType: string | null
}

export interface DmHistoryReaction {
  emoji: string // the emoji itself, or :name: for a custom one
  count: number // includes the bot's own reaction, when `me`
  me: boolean // whether the bot reacted with it
}

export interface DmHistoryMessage {
  id: string
  authorId: string
  content: string
  createdAt: string
  editedAt: string | null
  referencedMessageId: string | null // the message this one replies to, if any
  attachments: DmHistoryAttachment[]
  reactions: DmHistoryReaction[]
}

export interface DmHistoryEvalSuccess {
  ok: true
  channelId: string
  messages: DmHistoryMessage[]
}

export type DmHistoryEvalResult = DmHistoryEvalSuccess | DmEvalFailure
