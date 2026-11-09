import {
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js'

import { type CrmService } from '../services/crm-service.js'
import { Logger } from '../services/index.js'
import { PartialUtils } from '../utils/index.js'

/**
 * Tells the CRM when someone reacts to, or removes a reaction from, a DM the
 * bot sent them: staff follow those replies in the CRM. Reactions anywhere
 * else, and the bot's own, are ignored.
 */
export class DmReactionHandler {
  // Undefined when crm is disabled in config; reactions are then not forwarded.
  constructor(private crmService?: CrmService) {}

  public async process(
    msgReaction: MessageReaction | PartialMessageReaction,
    reactor: User | PartialUser,
    added: boolean,
  ): Promise<void> {
    const botId = msgReaction.client.user?.id
    if (!this.crmService || reactor.id === botId || msgReaction.message.guildId) {
      return
    }

    // A removed reaction may no longer be fetchable, so use what the event
    // carries and only fill in the message, to learn who sent it.
    const emoji = msgReaction.emoji.id
      ? msgReaction.emoji.name && `:${msgReaction.emoji.name}:`
      : msgReaction.emoji.name
    if (!emoji) {
      return
    }

    try {
      const message = await PartialUtils.fillMessage(msgReaction.message)
      if (!message || message.author.id !== botId) {
        return
      }
      const user = await PartialUtils.fillUser(reactor)
      if (!user || user.bot) {
        return
      }
      await this.crmService.reportReaction({
        message_id: message.id,
        user_id: user.id,
        emoji,
        added,
      })
    } catch (error) {
      Logger.warn(`Couldn't forward a DM reaction to the CRM: ${String(error)}`)
    }
  }
}
