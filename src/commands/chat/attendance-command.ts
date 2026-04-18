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
  formatAttendanceDmContent,
  resolveVoiceChannelMeetingSubject,
  type AttendanceEntry,
} from '../../services/attendance-service.js'
import { Lang } from '../../services/index.js'
import { InteractionUtils, MessageUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class AttendanceCommand implements Command {
  public names = [Lang.getRef('chatCommands.attendance', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []

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

    const entries: AttendanceEntry[] = Array.from(voiceChannel.members.values()).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.user.username ?? 'Unknown',
    }))

    const at = new Date()
    const meetingSubject = await resolveVoiceChannelMeetingSubject(
      intr.guild,
      voiceChannel.id,
      voiceChannel,
    )
    const dm = await MessageUtils.send(
      intr.user,
      formatAttendanceDmContent({
        channelName: voiceChannel.name,
        meetingSubject,
        entries,
        at,
      }),
    )

    if (!dm) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceDmFailed', data.lang),
        true,
      )
      return
    }

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.attendanceSnapshotSent', data.lang, {
        CHANNEL_NAME: voiceChannel.name,
      }),
    )
  }
}
