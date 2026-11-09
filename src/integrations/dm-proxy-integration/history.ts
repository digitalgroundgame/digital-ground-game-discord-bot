import { type Client, RESTJSONErrorCodes, type ShardingManager } from 'discord.js'
import { type Request, type Response } from 'express'

import { type Integration } from '../integration.js'
import {
  DISCORD_ID_REGEX,
  DmEvalFailure,
  DmHistoryEvalResult,
  DmHistoryMessage,
  DmHistoryPayload,
  ErrorResponse,
  EVAL_TIMEOUT_MS,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  ValidationError,
} from './constants.js'
import { evalOnOneShard } from './shard-eval.js'

// Stringified into the shard process by broadcastEval, so it can reference nothing outside itself.
const fetchDmHistoryOnShard = async (
  client: Client<true>,
  ctx: DmHistoryPayload,
): Promise<DmHistoryEvalResult> => {
  try {
    const user = await client.users.fetch(ctx.userId)
    // Opens the bot's DM channel with the user, or returns the existing one. Nothing is sent.
    const channel = await user.createDM()
    const messages = await channel.messages.fetch({
      limit: ctx.limit,
      before: ctx.before,
      after: ctx.after,
    })
    return {
      ok: true,
      channelId: channel.id,
      messages: messages.map((message) => ({
        id: message.id,
        authorId: message.author.id,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        editedAt: message.editedAt ? message.editedAt.toISOString() : null,
        referencedMessageId: message.reference?.messageId ?? null,
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          url: attachment.url,
          contentType: attachment.contentType ?? null,
        })),
        reactions: message.reactions.cache.map((reaction) => ({
          emoji: reaction.emoji.id ? `:${reaction.emoji.name}:` : (reaction.emoji.name ?? ''),
          count: reaction.count,
          me: reaction.me,
        })),
      })),
    }
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === 'number' ? error.code : undefined,
      message: typeof error.message === 'string' ? error.message : String(error),
    }
  }
}

const bySnowflake = (a: DmHistoryMessage, b: DmHistoryMessage): number => {
  const [left, right] = [BigInt(a.id), BigInt(b.id)]
  return left < right ? -1 : left > right ? 1 : 0
}

export class DmHistoryIntegration implements Integration {
  public name = 'DM History'
  public endpoint = '/dm-history'

  public async run(req: Request, res: Response, shardManager: ShardingManager): Promise<void> {
    try {
      const payload = this.validatePayload(req.body)

      const result: DmHistoryEvalResult = await evalOnOneShard(
        shardManager,
        fetchDmHistoryOnShard,
        payload,
        EVAL_TIMEOUT_MS,
      )

      if (!result.ok) {
        const { status, body } = this.httpErrorResponse(result)
        res.status(status).json(body)
        return
      }
      // Discord pages newest first; callers get the page oldest first, in conversation order.
      res.status(200).json({
        error: false,
        channelId: result.channelId,
        messages: [...result.messages].sort(bySnowflake),
      })
      return
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error

      res.status(400).json({ error: true, message: error.message })
      return
    }
  }

  private httpErrorResponse({ code, message }: DmEvalFailure): {
    status: number
    body: Omit<ErrorResponse, 'delivered'>
  } {
    if (code === RESTJSONErrorCodes.UnknownUser) {
      return { status: 404, body: { error: true, reason: 'unknown_user' } }
    }
    return { status: 502, body: { error: true, reason: 'discord_error', code, message } }
  }

  private validatePayload(body: unknown): DmHistoryPayload {
    const payload = body as Partial<Record<keyof DmHistoryPayload, unknown>> | null | undefined

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

    const limit = payload.limit ?? HISTORY_DEFAULT_LIMIT
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > HISTORY_MAX_LIMIT
    ) {
      throw new ValidationError(`limit must be an integer from 1 to ${HISTORY_MAX_LIMIT}.`)
    }

    for (const cursor of ['before', 'after'] as const) {
      const value = payload[cursor]
      if (value !== undefined && (typeof value !== 'string' || !DISCORD_ID_REGEX.test(value))) {
        throw new ValidationError(`${cursor} must be a Discord message ID string.`)
      }
    }
    if (payload.before !== undefined && payload.after !== undefined) {
      throw new ValidationError('Pass before or after, not both.')
    }

    return {
      userId: payload.userId,
      limit,
      ...(payload.before !== undefined && { before: payload.before as string }),
      ...(payload.after !== undefined && { after: payload.after as string }),
    }
  }
}
