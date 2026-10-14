import { type Message, type MessageReaction, type User } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { createRequire } from 'node:module'

import { type Reaction } from './reaction.js'
import { KudosEmoji, KudosGiveAllowedRoleIds } from '../constants/index.js'
import { type KudosService, Logger } from '../services/index.js'
import { RoleUtils } from '../utils/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

export interface KudosReactionOptions {
  /** Roles allowed to give Democracy Points; empty means anyone. Defaults to config. */
  allowedRoleIds?: string[]
  /** Coin reactions one member may have checked per window. Defaults to `rateLimiting.reactions`. */
  attemptLimit?: { amount: number; intervalMs: number }
}

/**
 * Reacting to a message with the kudos emoji gives its author a Democracy
 * Point. Reactions that can't count (self, bot/webhook/system author, missing
 * role, cooldown) are removed so a visible coin always means a recorded point.
 * The generic reaction limit is skipped because it would leave coins on
 * messages without recording points. Instead, a member past their own attempt
 * limit has the coin removed without the member lookup or database work, so
 * toggling the coin can't drive unbounded load.
 */
export class KudosReaction implements Reaction {
  public emoji = KudosEmoji
  public requireGuild = true
  public requireSentByClient = false
  public requireEmbedAuthorTag = false
  public rateLimited = false
  private readonly allowedRoleIds: string[]
  private readonly attemptLimiter: RateLimiter

  constructor(
    private readonly kudosService: KudosService,
    options: KudosReactionOptions = {},
  ) {
    this.allowedRoleIds = options.allowedRoleIds ?? KudosGiveAllowedRoleIds
    const limit = options.attemptLimit ?? {
      amount: Config.rateLimiting.reactions.amount,
      intervalMs: Config.rateLimiting.reactions.interval * 1000,
    }
    this.attemptLimiter = new RateLimiter(limit.amount, limit.intervalMs)
  }

  public async execute(msgReaction: MessageReaction, msg: Message, reactor: User): Promise<void> {
    if (!msg.guild) {
      return
    }

    if (this.attemptLimiter.take(reactor.id)) {
      await this.removeReaction(msgReaction, reactor)
      return
    }

    const author = msg.author
    if (author.bot || msg.webhookId || msg.system || author.id === reactor.id) {
      await this.removeReaction(msgReaction, reactor)
      return
    }

    if (this.allowedRoleIds.length > 0) {
      const member = await msg.guild.members.fetch(reactor.id).catch(() => null)
      if (!member || !RoleUtils.memberPassesRoleRestriction(member, this.allowedRoleIds)) {
        await this.removeReaction(msgReaction, reactor)
        return
      }
    }

    const result = await this.kudosService
      .giveKudos(msg.guild.id, reactor.id, author.id, undefined, {
        channelId: msg.channelId,
        messageId: msg.id,
      })
      .catch(async (error: unknown) => {
        // Take the coin back so it never stands without a recorded point.
        await this.removeReaction(msgReaction, reactor)
        throw error
      })

    switch (result.status) {
      case 'self':
      case 'cooldown': {
        await this.removeReaction(msgReaction, reactor)
        return
      }
      case 'duplicate': {
        // The coin was removed and re-added on a message that already earned
        // this giver's Democracy Point; it's still accurate, so leave it.
        return
      }
      case 'given': {
        Logger.info(`${reactor.tag} gave a Democracy Point to ${author.tag} by reaction`)
        return
      }
    }
  }

  private async removeReaction(msgReaction: MessageReaction, reactor: User): Promise<void> {
    try {
      await msgReaction.users.remove(reactor.id)
    } catch (error) {
      Logger.warn(
        `democracy-points: couldn't remove ${reactor.tag}'s reaction; the bot may be missing Manage Messages`,
        error,
      )
    }
  }
}
