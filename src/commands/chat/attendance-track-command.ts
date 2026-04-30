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

// Maps each CRM rejection reason to the lang key for the user-facing message.
// Two variants of AttendancePermissionReason are intentionally not in this map:
//   - 'ok'             — authorized=true short-circuits before we reach this lookup.
//   - 'missing_tracker' — the bot always supplies a discord_id, so the CRM
//                         should never return this code in practice. If it ever
//                         does, the missing entry falls through to FALLBACK_LANG_KEY
//                         and the user sees the generic "couldn't verify" message.
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
