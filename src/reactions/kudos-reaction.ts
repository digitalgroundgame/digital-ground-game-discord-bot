import { type Message, type MessageReaction, type User } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { createRequire } from 'node:module'

import { type Reaction } from './reaction.js'
import { KudosEmoji, KudosGiveAllowedRoleIds } from '../constants/index.js'
import { type KudosService, Logger } from '../services/index.js'
import { RoleUtils } from '../utils/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** Reason prefix recorded for a coin on a give announcement. */
const PILE_ON_REASON = 'pile on'

export interface KudosReactionOptions {
  /** Roles allowed to give Democracy Points; empty means anyone. Defaults to config. */
  allowedRoleIds?: string[]
  /** Coin reactions one member may have checked per window. Defaults to `rateLimiting.reactions`. */
  attemptLimit?: { amount: number; intervalMs: number }
}

/**
 * Reacting to a message with the kudos emoji gives its author a Democracy
 * Point. Reacting to the bot's announcement of a `/democracy-points give`
 * instead gives the announced receiver a point, so others can pile on.
 * Reactions that can't count (self, bot/webhook/system author, missing
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

    const target = await this.findTarget(msg, msg.guild.id)
    const receiverId = target?.receiverId
    if (!receiverId || receiverId === reactor.id) {
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
      .giveKudos(msg.guild.id, reactor.id, receiverId, target.reason, {
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
        Logger.info(`${reactor.tag} gave a Democracy Point to ${receiverId} by reaction`)
        return
      }
    }
  }

  /**
   * Who a coin on this message rewards, and the reason to record: the author
   * of a member's message, or the receiver of one of the bot's own give
   * announcements, with the announced reason marked as a pile-on. Other bot,
   * webhook, and system messages reward no one.
   */
  private async findTarget(
    msg: Message,
    guildId: string,
  ): Promise<{ receiverId: string; reason?: string } | null> {
    // Checked before the webhook test: an interaction follow-up like the
    // announcement is sent through the app's webhook, so it has a webhookId.
    if (msg.author.id === msg.client.user?.id) {
      const give = await this.kudosService.getGiveForMessage(guildId, msg.id)
      if (!give) {
        return null
      }
      return {
        receiverId: give.receiverDiscordId,
        reason: give.reason ? `${PILE_ON_REASON}: ${give.reason}` : PILE_ON_REASON,
      }
    }
    if (msg.webhookId || msg.system || msg.author.bot) {
      return null
    }
    return { receiverId: msg.author.id }
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
