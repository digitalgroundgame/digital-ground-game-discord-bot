import { type RESTJSONErrorCodes } from 'discord.js'

export const DISCORD_ID_REGEX = /^\d{17,20}$/
export const MESSAGE_MAX_LENGTH = 2000

// The ceiling has to clear a cold send — `users.fetch` then `user.send`, each with its own 15s
// @discordjs/rest timeout, plus any rate-limit wait — or it would abort sends that would land.
export const SEND_TIMEOUT_MS = 30_000

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

export interface DmSendFailure {
  ok: false
  code?: number
  message: string
}

export interface DmSendSuccess {
  ok: true
}

export type DmSendResult = DmSendSuccess | DmSendFailure
