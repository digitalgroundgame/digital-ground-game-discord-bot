import { type Client, RESTJSONErrorCodes } from 'discord.js'
import { type Request, type Response } from 'express'

import { type Integration } from '../integration.js'
import {
  DISCORD_ID_REGEX,
  DmSendFailure,
  DmSendResult,
  ErrorResponse,
  SEND_TIMEOUT_MS,
  MESSAGE_MAX_LENGTH,
  SendDmPayload,
  ValidationError,
} from './constants.js'

const sendDm = async (client: Client, payload: SendDmPayload): Promise<DmSendResult> => {
  try {
    const user = await client.users.fetch(payload.userId)
    await user.send(payload.message)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : String(error),
    }
  }
}

export class DmProxyIntegration implements Integration {
  public name = 'DM Proxy'
  public endpoint = '/send-dm'

  public async run(req: Request, res: Response, client: Client): Promise<void> {
    try {
      const payload = this.validatePayload(req.body)

      let timer: NodeJS.Timeout | undefined
      const result: DmSendResult = await Promise.race([
        sendDm(client, payload),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Discord did not answer within ${SEND_TIMEOUT_MS}ms.`)),
            SEND_TIMEOUT_MS,
          )
        }),
      ]).finally(() => clearTimeout(timer))

      if (!result.ok) {
        const { status, body } = this.httpErrorResponse(result)
        res.status(status).json(body)
        return
      }
      res.status(200).json({ error: false, delivered: true })
      return
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error

      res.status(400).json({ error: true, message: error.message })
      return
    }
  }

  private httpErrorResponse({ code, message }: DmSendFailure): {
    status: number
    body: ErrorResponse
  } {
    switch (code) {
      case RESTJSONErrorCodes.CannotSendMessagesToThisUser:
      case RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds:
        return { status: 200, body: { error: false, delivered: false, reason: 'dms_closed' } }
      case RESTJSONErrorCodes.UnknownUser:
        return { status: 404, body: { error: true, delivered: false, reason: 'unknown_user' } }
      default:
        return {
          status: 502,
          body: {
            error: true,
            delivered: false,
            reason: 'discord_error',
            code,
            message,
          },
        }
    }
  }

  private validatePayload(body: unknown): SendDmPayload {
    const payload = body as Partial<SendDmPayload> | null | undefined

    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Request body must be a JSON object.')
    }
    if (typeof payload.userId !== 'string') {
      throw new ValidationError(
        `userId must be a string Discord user ID, got: ${typeof payload.userId}`,
      )
    }
    if (!DISCORD_ID_REGEX.test(payload.userId)) {
      throw new ValidationError('userId must be a Discord snowflake (17-20 digits).')
    }
    if (typeof payload.message !== 'string') {
      throw new ValidationError(`message must be a string, got: ${typeof payload.message}`)
    }
    if (payload.message.length === 0) {
      throw new ValidationError('message must not be empty.')
    }
    if (payload.message.length > MESSAGE_MAX_LENGTH) {
      throw new ValidationError(
        `message must be at most ${MESSAGE_MAX_LENGTH} characters, got: ${payload.message.length}`,
      )
    }
    return { userId: payload.userId, message: payload.message }
  }
}
