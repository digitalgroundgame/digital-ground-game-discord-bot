import type { VoiceState } from 'discord.js'

import { type EventHandler } from './event-handler.js'
import { AttendanceService } from '../services/attendance-service.js'
import { Logger } from '../services/logger.js'

export class VoiceStateUpdateHandler implements EventHandler {
  constructor(private readonly attendanceService: AttendanceService) {}

  public async process(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      await this.attendanceService.handleVoiceStateUpdate(oldState, newState)
    } catch (error) {
      Logger.error('Failed to process voice state update for attendance tracking', error)
    }
  }
}
