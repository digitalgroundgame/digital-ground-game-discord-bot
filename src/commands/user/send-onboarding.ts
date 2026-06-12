import { type PermissionsString, type UserContextMenuCommandInteraction } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { ContentService, Lang, Logger } from '../../services/index.js'
import { InteractionUtils, MessageUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'
import { ContentKeys, ServerRoles } from '../../constants/index.js'

export interface OnboardingConfig {
  key: string
  /** Managed content key holding the DM's title and message. */
  contentKey: string
  langKey: string
  metadataKey: string
}

export const ONBOARDING_CONFIGS: OnboardingConfig[] = [
  {
    key: 'dev',
    contentKey: ContentKeys.OnboardingDev,
    langKey: 'userCommands.sendDevOnboarding',
    metadataKey: 'SEND_DEV_ONBOARDING',
  },
  {
    key: 'media',
    contentKey: ContentKeys.OnboardingMedia,
    langKey: 'userCommands.sendMediaOnboarding',
    metadataKey: 'SEND_MEDIA_ONBOARDING',
  },
  {
    key: 'research',
    contentKey: ContentKeys.OnboardingResearch,
    langKey: 'userCommands.sendResearchOnboarding',
    metadataKey: 'SEND_RESEARCH_ONBOARDING',
  },
  {
    key: 'events',
    contentKey: ContentKeys.OnboardingEvents,
    langKey: 'userCommands.sendEventsOnboarding',
    metadataKey: 'SEND_EVENTS_ONBOARDING',
  },
  {
    key: 'welcome',
    contentKey: ContentKeys.OnboardingWelcome,
    langKey: 'userCommands.sendWelcomeOnboarding',
    metadataKey: 'SEND_WELCOME_ONBOARDING',
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

  public constructor(
    config: OnboardingConfig,
    private readonly contentService?: ContentService,
  ) {
    this.config = config
    this.names = [Lang.getRef(config.langKey, Language.Default)]

    Logger.info(`Created ${config.key}'s SendOnboarding command: ${this.names}`)
  }

  public async execute(intr: UserContextMenuCommandInteraction, data: EventData): Promise<void> {
    // Resolved at send time so /content edits apply without a restart.
    const { title, message } = this.contentService
      ? await this.contentService.getContent(this.config.contentKey)
      : ContentService.getDefaults(this.config.contentKey)

    try {
      await MessageUtils.send(
        intr.targetUser,
        Lang.getEmbed('displayEmbeds.onboarding', data.lang, {
          TITLE: title ?? '',
          CONTENT: message ?? '',
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

      Logger.warn(
        `Failed to send ${this.config.key} onboarding; ${intr.targetUser.tag} has DMs off`,
      )
    }
  }
}
