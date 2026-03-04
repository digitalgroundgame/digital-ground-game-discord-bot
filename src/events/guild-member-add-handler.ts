import { type GuildMember } from 'discord.js'

import { type EventHandler } from './event-handler.js'
import { WelcomeThreadService } from '../services/welcome-thread-service.js'

/**
 * Handles GuildMemberAdd events. Creates a welcome thread for each new member
 * regardless of which role they select (or none). Bots are ignored.
 */
export class GuildMemberAddHandler implements EventHandler {
  public async process(member: GuildMember): Promise<void> {
    if (member.user.bot) {
      return
    }

    await WelcomeThreadService.createWelcomeThread(member)
  }
}
