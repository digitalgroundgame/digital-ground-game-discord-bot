import {
  type ChatInputCommandInteraction,
  type PermissionsString,
  VoiceChannel,
  StageChannel,
} from 'discord.js'

import { RateLimiter } from 'discord.js-rate-limiter'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import type { AttendanceService } from '../../services/attendance-service.js'
import {
  type AttendancePermissionReason,
  type CrmAttendancePermissionResponse,
  type CrmService,
} from '../../services/crm-service.js'
import { Lang } from '../../services/index.js'
import { Logger } from '../../services/logger.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

// 'ok' intentionally absent — the caller branches on authorized first.
// 'missing_tracker' falls back to the generic message because the bot
// always supplies a discord_id, so the CRM should never report it.
const REASON_TO_LANG_KEY: Partial<Record<AttendancePermissionReason, string>> = {
  not_authorized: 'displayEmbeds.attendanceNotAuthorized',
  unlinked_discord_id: 'displayEmbeds.attendanceUnlinkedDiscordId',
}

const FALLBACK_LANG_KEY = 'displayEmbeds.attendancePermissionCheckFailed'

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

    let permission: CrmAttendancePermissionResponse
    try {
      permission = await this.crmService.checkAttendancePermission(intr.user.id)
    } catch (error) {
      Logger.error('CRM can-record-attendance check failed', error)
      await InteractionUtils.send(intr, Lang.getEmbed(FALLBACK_LANG_KEY, data.lang), true)
      return
    }

    if (!permission.authorized) {
      const langKey = REASON_TO_LANG_KEY[permission.reason] ?? FALLBACK_LANG_KEY
      await InteractionUtils.send(intr, Lang.getEmbed(langKey, data.lang), true)
      return
    }

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
    )

    if (!started) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceAlreadyTracking', data.lang),
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
