import { type Message } from 'discord.js'

import { type CrmService } from '../services/crm-service.js'
import { type EventHandler, type TriggerHandler } from './index.js'

export class MessageHandler implements EventHandler {
  constructor(
    private triggerHandler: TriggerHandler,
    // Undefined when crm is disabled in config; DMs are then not forwarded.
    private crmService?: CrmService,
  ) {}

  public async process(msg: Message): Promise<void> {
    // Don't respond to system messages or self
    if (msg.system || msg.author.id === msg.client.user?.id) {
      return
    }

    // Tell the CRM about every DM a person sends the bot; the CRM decides which
    // ones it cares about. Not awaited, and reportInboundDm never throws.
    if (!msg.guildId && !msg.author.bot && this.crmService) {
      void this.crmService.reportInboundDm({
        message_id: msg.id,
        channel_id: msg.channelId,
        author_id: msg.author.id,
        created_at: msg.createdAt.toISOString(),
      })
    }

    // Process trigger
    await this.triggerHandler.process(msg)
  }
}
