import { RESTJSONErrorCodes, type ShardingManager } from 'discord.js'
import { type Request, type Response } from 'express'
import { createRequire } from 'node:module'

import { type Integration } from './integration.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

const DISCORD_ID_REGEX = /^\d{17,20}$/
const MESSAGE_MAX_LENGTH = 2000

interface SendDmPayload {
  userId: string
  message: string
}

// broadcastEval callbacks are stringified and re-evaluated in the shard process,
// so errors must come back as plain serializable data, not thrown Error objects.
interface DmEvalResult {
  ok: boolean
  code: number | null
  message: string
}

export class DmProxyIntegration implements Integration {
  public name: string = Config.integrations.dmProxy.name
  public endpoint: string = '/send-dm'

  public async run(req: Request, res: Response, shardManager: ShardingManager): Promise<void> {
    const err = this.validatePayload(req.body)
    if (err) {
      res.status(400).json({ error: true, message: err.message })
      return
    }
    const { userId, message } = req.body as SendDmPayload

    const evalResult = await shardManager.broadcastEval(
      async (client, ctx): Promise<DmEvalResult> => {
        // Self-contained: this function runs in the shard process and cannot
        // reference anything from this module's scope except `ctx`.
        try {
          const user = await client.users.fetch(ctx.userId)
          await user.send(ctx.message)
          return { ok: true, code: null, message: '' }
        } catch (error) {
          const e = error as { code?: unknown; message?: unknown }
          return {
            ok: false,
            code: typeof e.code === 'number' ? e.code : null,
            message: typeof e.message === 'string' ? e.message : String(error),
          }
        }
      },
      // Pin to a single shard: users.fetch() succeeds on every shard, so an
      // unconstrained broadcast would DM once per shard.
      { shard: 0, context: { userId, message } },
    )
    const result: DmEvalResult = Array.isArray(evalResult) ? evalResult[0]! : evalResult

    if (result.ok) {
      res.status(200).json({ error: false, delivered: true })
      return
    }

    switch (result.code) {
      case RESTJSONErrorCodes.CannotSendMessagesToThisUser:
        // User blocked the bot or has DMs disabled — terminal, but not an
        // error (matches MessageUtils.send's IGNORED_ERRORS convention).
        res.status(200).json({ error: false, delivered: false, reason: 'dms_closed' })
        return
      case RESTJSONErrorCodes.UnknownUser:
        res.status(404).json({ error: true, delivered: false, reason: 'unknown_user' })
        return
      default:
        res.status(502).json({
          error: true,
          delivered: false,
          reason: 'discord_error',
          code: result.code,
          message: result.message,
        })
    }
  }

  private validatePayload(body: unknown): TypeError | null {
    const payload = body as Partial<SendDmPayload> | null | undefined

    if (!payload || typeof payload !== 'object') {
      return new TypeError('Request body must be a JSON object.')
    }
    if (typeof payload.userId !== 'string') {
      return new TypeError(`userId must be a string Discord user ID, got: ${typeof payload.userId}`)
    }
    if (!DISCORD_ID_REGEX.test(payload.userId)) {
      return new TypeError('userId must be a Discord snowflake (17-20 digits).')
    }
    if (typeof payload.message !== 'string') {
      return new TypeError(`message must be a string, got: ${typeof payload.message}`)
    }
    if (payload.message.length === 0) {
      return new TypeError('message must not be empty.')
    }
    if (payload.message.length > MESSAGE_MAX_LENGTH) {
      return new TypeError(
        `message must be at most ${MESSAGE_MAX_LENGTH} characters, got: ${payload.message.length}`,
      )
    }
    return null
  }
}
