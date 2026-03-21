import { type PermissionsString, type UserContextMenuCommandInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger } from '../../services/index.js'
import { InteractionUtils, MessageUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'
import { EventsOnboarding } from '../../constants/onboarding.js'
import { ServerRoles } from '../../constants/index.js'

export class SendEventsOnboarding implements Command {
  public names = [Lang.getRef('userCommands.sendEventsOnboarding', Language.Default)]
  public cooldown = new RateLimiter(5, 5000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = [ServerRoles.COORDINATOR.id, ServerRoles.ADMIN.id, ServerRoles.DIRECTOR.id,
                         ServerRoles.ORGANIZER.id, ServerRoles.TEAM_LEAD.id]

  public constructor() {
    Logger.info(`Created SendEventsOnboarding command add: ${this.names}`)
  }

  public async execute(intr: UserContextMenuCommandInteraction, data: EventData): Promise<void> {
    try {
      // Send the events info
      await MessageUtils.send(
        intr.targetUser,
        Lang.getEmbed('displayEmbeds.onboarding', data.lang, {
          TITLE: EventsOnboarding.Title,
          CONTENT: EventsOnboarding.Message,
        }),
      )

      // Inform the sender it worked
      await InteractionUtils.send(intr, {
        content: `${Lang.getCom('emojis.yes')} Sent events onboarding info to ${intr.targetUser.tag}!`,
        ephemeral: true,
      })

      Logger.info(`Send events onboarding to ${intr.targetUser.displayName}`)
    } catch {
      // Inform the sender it didn't work
      await InteractionUtils.send(intr, {
        content: `${Lang.getCom('emojis.no')} User DMs are disabled! Failed to send.`,
        ephemeral: true,
      })

      // Log the issue
      Logger.warn(`Failed to send events onboarding; ${intr.targetUser.tag} has DMs off`)
    }
  }
}
