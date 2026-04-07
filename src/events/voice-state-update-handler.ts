import type { Client, VoiceState } from 'discord.js'

import { type EventHandler } from './event-handler.js'
import {
  AttendanceService,
  formatAttendanceDmContent,
  resolveVoiceChannelMeetingSubject,
} from '../services/attendance-service.js'
import { Logger } from '../services/logger.js'
import { MessageUtils } from '../utils/message-utils.js'

export class VoiceStateUpdateHandler implements EventHandler {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly client: Client,
  ) {}

  public async process(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const result = this.attendanceService.handleVoiceStateUpdate(oldState, newState)
    if (!result) return

    const { userId, guildId, channelId, channelName, entries } = result
    try {
      const user = await this.client.users.fetch(userId)
      const guild = await this.client.guilds.fetch(guildId)
      const channel = await guild.channels.fetch(channelId).catch(() => null)
      const meetingSubject = await resolveVoiceChannelMeetingSubject(guild, channelId, channel)
      await MessageUtils.send(
        user,
        formatAttendanceDmContent({
          channelName,
          meetingSubject,
          entries,
          at: new Date(),
        }),
      )
    } catch (error) {
      Logger.error('Failed to send attendance DM', error)
    }
  }
}
