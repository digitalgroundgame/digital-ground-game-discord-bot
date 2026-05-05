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
  resolveVoiceChannelMeetingSubject,
  type AttendanceService,
} from '../../services/attendance-service.js'
import { Lang } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class AttendanceTrackCommand implements Command {
  public names = [Lang.getRef('chatCommands.attendanceTrack', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []

  constructor(private readonly attendanceService: AttendanceService) {}

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

    if (await this.attendanceService.isTracking(intr.user.id)) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceAlreadyTracking', data.lang),
        true,
      )
      return
    }

    const initialMembers = Array.from(voiceChannel.members.values()).map((m) => ({
      id: m.id,
      displayName: m.displayName ?? m.user.username ?? 'Unknown',
    }))

    const meetingSubject = await resolveVoiceChannelMeetingSubject(
      intr.guild,
      voiceChannel.id,
      voiceChannel,
    )

    const started = await this.attendanceService.startTracking(
      intr.user.id,
      voiceChannel.id,
      voiceChannel.name,
      initialMembers,
      meetingSubject,
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
