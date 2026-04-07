import { type PermissionsString, type UserContextMenuCommandInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger } from '../../services/index.js'
import { InteractionUtils, MessageUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'
import { ServerRoles } from '../../constants/index.js'
import { DevOnboarding, MediaOnboarding, ResearchOnboarding, EventsOnboarding, WelcomeOnboarding } from '../../constants/onboarding.js'

export interface OnboardingConfig {
  key: string
  title: string
  message: string
  langKey: string
  metadataKey: string
}

export const ONBOARDING_CONFIGS: OnboardingConfig[] = [
  {
    key: 'dev',
    title: DevOnboarding.Title,
    message: DevOnboarding.Message,
    langKey: 'userCommands.sendDevOnboarding',
    metadataKey: "SEND_DEV_ONBOARDING"
  },
  {
    key: 'media',
    title: MediaOnboarding.Title,
    message: MediaOnboarding.Message,
    langKey: 'userCommands.sendMediaOnboarding',
    metadataKey: "SEND_MEDIA_ONBOARDING"
  },
  {
    key: 'research',
    title: ResearchOnboarding.Title,
    message: ResearchOnboarding.Message,
    langKey: 'userCommands.sendResearchOnboarding',
    metadataKey: "SEND_RESEARCH_ONBOARDING"
  },
  {
    key: 'events',
    title: EventsOnboarding.Title,
    message: EventsOnboarding.Message,
    langKey: 'userCommands.sendEventsOnboarding',
    metadataKey: "SEND_EVENTS_ONBOARDING"
  },
  {
    key: 'welcome',
    title: WelcomeOnboarding.Title,
    message: WelcomeOnboarding.Message,
    langKey: 'userCommands.sendWelcomeOnboarding',
    metadataKey: "SEND_WELCOME_ONBOARDING"
  },
]

export class SendOnboarding implements Command {
  public names: string[]
  public cooldown = new RateLimiter(5, 5000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = [
    ServerRoles.COORDINATOR.id,
    ServerRoles.ADMIN.id,
    ServerRoles.DIRECTOR.id,
    ServerRoles.ORGANIZER.id,
    ServerRoles.TEAM_LEAD.id,
  ]

  private config: OnboardingConfig

  public constructor(config: OnboardingConfig) {
    this.config = config
    this.names = [Lang.getRef(config.langKey, Language.Default)]

    Logger.info(`Created ${config.key}'s SendOnboarding command: ${this.names}`)
  }

  public async execute(intr: UserContextMenuCommandInteraction, data: EventData): Promise<void> {
    try {
      await MessageUtils.send(
        intr.targetUser,
        Lang.getEmbed('displayEmbeds.onboarding', data.lang, {
          TITLE: this.config.title,
          CONTENT: this.config.message,
        }),
      )

      await InteractionUtils.send(intr, {
        content: `${Lang.getCom('emojis.yes')} Sent ${this.config.key} onboarding info to ${intr.targetUser.tag}!`,
        ephemeral: true,
      })

      Logger.info(`Sent ${this.config.key} onboarding to ${intr.targetUser.displayName}`)
    } catch {
      await InteractionUtils.send(intr, {
        content: `${Lang.getCom('emojis.no')} User DMs are disabled! Failed to send.`,
        ephemeral: true,
      })

      Logger.warn(`Failed to send ${this.config.key} onboarding; ${intr.targetUser.tag} has DMs off`)
    }
  }
}