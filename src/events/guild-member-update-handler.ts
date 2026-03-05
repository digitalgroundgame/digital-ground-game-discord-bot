import { type GuildMember, type PartialGuildMember } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'
import { createRequire } from 'node:module'

import { type EventHandler } from './event-handler.js'
import type { MemberUpdateContext, MemberUpdateUseCase } from './member-update-types.js'
import { Logger } from '../services/logger.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Handles GuildMemberUpdate events by running registered use cases.
 * Each use case runs independently; one bailing or failing does not affect others.
 */
export class GuildMemberUpdateHandler implements EventHandler {
  private rateLimiter = new RateLimiter(
    Config.rateLimiting.buttons?.amount ?? 10,
    (Config.rateLimiting.buttons?.interval ?? 30) * 1000,
  )

  constructor(private readonly useCases: MemberUpdateUseCase[]) {}

  /**
   * Process a GuildMemberUpdate event.
   * Applies shared guards (bots, rate limit), builds context, then runs each use case.
   */
  public async process(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    if (newMember.user.bot) {
      return
    }

    const limited = this.rateLimiter.take(newMember.id)
    if (limited) {
      return
    }

    const oldRoles = oldMember.roles.cache
    const newRoles = newMember.roles.cache
    const context: MemberUpdateContext = {
      addedRoles: newRoles.filter((role) => !oldRoles.has(role.id)),
      removedRoles: oldRoles.filter((role) => !newRoles.has(role.id)),
    }

    for (const useCase of this.useCases) {
      try {
        await useCase.handle(oldMember, newMember, context)
      } catch (err) {
        Logger.error(err, 'Member update use case threw; other use cases still run')
      }
    }
  }
}
