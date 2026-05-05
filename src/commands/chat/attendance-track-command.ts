import {
  type ChatInputCommandInteraction,
  type PermissionsString,
  VoiceChannel,
  StageChannel,
} from 'discord.js'

import { RateLimiter } from 'discord.js-rate-limiter'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type AttendanceService,
  type CrmDisabledReason,
} from '../../services/attendance-service.js'
import { type CrmService } from '../../services/crm-service.js'
import { Lang } from '../../services/index.js'
import { Logger } from '../../services/logger.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

const REASON_TO_LANG_KEY: Record<CrmDisabledReason, string> = {
  not_authorized: 'displayEmbeds.attendanceNotAuthorized',
  unlinked_discord_id: 'displayEmbeds.attendanceUnlinkedDiscordId',
  check_failed: 'displayEmbeds.attendancePermissionCheckFailed',
}

export class AttendanceTrackCommand implements Command {
  public names = [Lang.getRef('chatCommands.attendanceTrack', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly crmService: CrmService,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!intr.guild) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceNotInVC', data.lang),
        true,
      )
      return
    }
    const member = await intr.guild.members.fetch(intr.user.id).catch(() => null)
    const voiceChannel = member?.voice?.channel ?? null
    if (
      !voiceChannel ||
      !(voiceChannel instanceof VoiceChannel || voiceChannel instanceof StageChannel)
    ) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceNotInVC', data.lang),
        true,
      )
      return
    }

    if (this.attendanceService.isTracking(intr.user.id)) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceAlreadyTracking', data.lang),
        true,
      )
      return
    }

    let crmDisabledReason: CrmDisabledReason | undefined
    try {
      const permission = await this.crmService.checkAttendancePermission(intr.user.id)
      if (!permission.authorized) {
        crmDisabledReason =
          permission.reason === 'not_authorized' || permission.reason === 'unlinked_discord_id'
            ? permission.reason
            : 'check_failed'
      }
    } catch (error) {
      Logger.error('CRM can-record-attendance check failed', error)
      crmDisabledReason = 'check_failed'
    }

    const customName = intr.options.getString(
      Lang.getRef('arguments.attendanceEventName', Language.Default),
    )

    const initialMembers = Array.from(voiceChannel.members.values()).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.user.username ?? 'Unknown',
    }))

    const started = this.attendanceService.startTracking(
      intr.user.id,
      voiceChannel.id,
      voiceChannel.guild.id,
      voiceChannel.name,
      initialMembers,
      customName ?? undefined,
      crmDisabledReason,
    )

    if (!started) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceAlreadyTracking', data.lang),
        true,
      )
      return
    }

    if (crmDisabledReason) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed(REASON_TO_LANG_KEY[crmDisabledReason], data.lang, {
          CHANNEL_NAME: voiceChannel.name,
        }),
        true,
      )
      return
    }

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.attendanceTrackStarted', data.lang, {
        CHANNEL_NAME: voiceChannel.name,
      }),
    )
  }
}
