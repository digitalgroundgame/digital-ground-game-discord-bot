import { type Message, type MessageReaction, type User } from 'discord.js'

import { type Reaction } from './reaction.js'
import { KudosEmoji, KudosGiveAllowedRoleKeys, ServerRoles } from '../constants/index.js'
import { type EventData } from '../models/internal-models.js'
import { type KudosNotifier, type KudosService, Logger } from '../services/index.js'
import { RoleUtils } from '../utils/index.js'

export interface KudosReactionOptions {
  /** Roles allowed to give kudos; empty means anyone. Defaults to config. */
  allowedRoleIds?: string[]
}

/**
 * Reacting to a message with the kudos emoji gives its author kudos. Reactions
 * that can't count (self, bot/webhook/system author, missing role, cooldown)
 * are removed so a visible coin always means a recorded kudos.
 */
export class KudosReaction implements Reaction {
  public emoji = KudosEmoji
  public requireGuild = true
  public requireSentByClient = false
  public requireEmbedAuthorTag = false
  private readonly allowedRoleIds: string[]

  constructor(
    private readonly kudosService: KudosService,
    private readonly notifier: KudosNotifier,
    options: KudosReactionOptions = {},
  ) {
    this.allowedRoleIds =
      options.allowedRoleIds ?? KudosGiveAllowedRoleKeys.map((key) => ServerRoles[key].id)
  }

  public async execute(
    msgReaction: MessageReaction,
    msg: Message,
    reactor: User,
    data: EventData,
  ): Promise<void> {
    if (!msg.guild) {
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

    const result = await this.kudosService.giveKudos(
      msg.guild.id,
      reactor.id,
      author.id,
      undefined,
      { channelId: msg.channelId, messageId: msg.id },
    )

    switch (result.status) {
      case 'self':
      case 'cooldown': {
        await this.removeReaction(msgReaction, reactor)
        return
      }
      case 'duplicate': {
        // The coin was removed and re-added on a message that already earned
        // this giver's kudos; it's still accurate, so leave it.
        return
      }
      case 'given': {
        await this.notifier.notify(msg.guild.id, author, result.givenAt, data.lang)
        Logger.info(`${reactor.tag} gave kudos to ${author.tag} by reaction`)
        return
      }
    }
  }

  private async removeReaction(msgReaction: MessageReaction, reactor: User): Promise<void> {
    try {
      await msgReaction.users.remove(reactor.id)
    } catch (error) {
      Logger.warn(
        `kudos: couldn't remove ${reactor.tag}'s reaction; the bot may be missing Manage Messages`,
        error,
      )
    }
  }
}
