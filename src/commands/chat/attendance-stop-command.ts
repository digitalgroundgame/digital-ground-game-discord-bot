import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import type { AttendanceService } from '../../services/attendance-service.js'
import { Lang } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class AttendanceStopCommand implements Command {
  public names = [Lang.getRef('chatCommands.attendanceStop', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []

  constructor(private readonly attendanceService: AttendanceService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const stopped = await this.attendanceService.stopTracking(intr.user.id)
    if (!stopped) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.attendanceNotTracking', data.lang),
        true,
      )
      return
    }
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.attendanceTrackStopped', data.lang),
    )
  }
}
