import { type RESTJSONErrorCodes } from 'discord.js'

export const DISCORD_ID_REGEX = /^\d{17,20}$/
export const MESSAGE_MAX_LENGTH = 2000

// `Shard#eval` has no timer of its own: it settles only when the child answers, so a shard that
// dies mid-eval, blocks its event loop, or is still spawning leaves the request hanging forever.
// The ceiling has to clear a cold send — `users.fetch` then `user.send`, each with its own 15s
// @discordjs/rest timeout, plus any rate-limit wait — or it would abort sends that would land.
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
}

export type DmEvalResult = DmEvalSuccess | DmEvalFailure
