import { type RESTJSONErrorCodes } from 'discord.js'

export const DISCORD_ID_REGEX = /^\d{17,20}$/
export const MESSAGE_MAX_LENGTH = 2000

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
