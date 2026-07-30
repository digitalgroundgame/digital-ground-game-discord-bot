import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { type VoiceStateUpdateHandler } from '../../events/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { type AttendanceService, Lang } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class StopAttendanceTrackCommand implements Command {
  public names = [Lang.getRef('chatCommands.stopAttendanceTrack', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly voiceStateUpdateHandler: VoiceStateUpdateHandler,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const result = this.attendanceService.stopTracking(intr.user.id)
    if (!result) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceNotTracking', data.lang),
        true,
      )
      return
    }

    await this.voiceStateUpdateHandler.processCompletedSession(result)
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.attendanceTrackStopped', data.lang, {
        CHANNEL_NAME: result.channelName,
      }),
    )
  }
}
