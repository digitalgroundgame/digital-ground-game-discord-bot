import { createRequire } from 'node:module'

import type { MemberUpdateContext, MemberUpdateUseCase } from '../member-update-types.js'
import type { GuildMember, PartialGuildMember } from 'discord.js'
import { Logger } from '../../services/logger.js'
import type { OnboardingStateService } from '../../services/onboarding-state-service.js'

const require = createRequire(import.meta.url)
const Config = require('../../../config/config.json')

/**
 * Use case: when a member gains or loses a team interest role (from Config.teams),
 * queue or cancel welcome thread creation.
 * No-ops if Config.teams is missing or has no interest roles.
 */
export class InterestRolesMemberUpdateUseCase implements MemberUpdateUseCase {
  constructor(private readonly onboardingStateService: OnboardingStateService) {}

  async handle(
    _oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    context: MemberUpdateContext,
  ): Promise<void> {
    const teams = Config.teams as Record<string, { interestRoleName?: string }> | undefined

    if (!teams) {
      return
    }

    for (const [roleId, role] of context.addedRoles) {
      const teamName = Object.keys(teams).find(
        (team) => teams[team]?.interestRoleName === role.name,
      )

      if (teamName) {
        Logger.info(
          `Detected team interest role addition: ${newMember.user.tag} received "${role.name}" (team: ${teamName})`,
        )

        this.onboardingStateService.queueChannelCreation(newMember, teamName, roleId)
      }
    }

    for (const [roleId, role] of context.removedRoles) {
      const teamName = Object.keys(teams).find(
        (team) => teams[team]?.interestRoleName === role.name,
      )

      if (teamName) {
        Logger.info(
          `Detected team interest role removal: ${newMember.user.tag} lost "${role.name}" (team: ${teamName})`,
        )

        this.onboardingStateService.cancelPendingCreation(newMember.guild.id, newMember.id, roleId)
      }
    }
  }
}
