import { type ChatInputCommandInteraction } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type VoiceStateUpdateHandler } from '../../src/events/index.js'
import { type EventData } from '../../src/models/internal-models.js'
import { type AttendanceService } from '../../src/services/index.js'

const sendMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../../src/utils/index.js', () => ({
  InteractionUtils: {
    send: sendMock,
  },
}))

describe('StopAttendanceTrackCommand', () => {
  beforeEach(() => {
    sendMock.mockClear()
  })

  it('finalizes the active session and confirms it was stopped', async () => {
    const { StopAttendanceTrackCommand } =
      await import('../../src/commands/chat/stop-attendance-track-command.js')
    const completedSession = {
      userId: 'tracker-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      channelName: 'Strategy Room',
      sessionId: 'session-1',
      defaultEventName: 'Strategy Room - Jul 15, 2026 10:00 AM UTC',
      entries: [{ id: 'tracker-1', displayName: 'Tracker' }],
    }
    const attendanceService = {
      stopTracking: vi.fn(() => completedSession),
    } as unknown as AttendanceService
    const voiceStateUpdateHandler = {
      processCompletedSession: vi.fn(async () => undefined),
    } as unknown as VoiceStateUpdateHandler
    const command = new StopAttendanceTrackCommand(attendanceService, voiceStateUpdateHandler)
    const interaction = { user: { id: 'tracker-1' } } as ChatInputCommandInteraction

    await command.execute(interaction, { lang: 'en-US' } as EventData)

    expect(attendanceService.stopTracking).toHaveBeenCalledWith('tracker-1')
    expect(voiceStateUpdateHandler.processCompletedSession).toHaveBeenCalledWith(completedSession)
    expect(sendMock).toHaveBeenCalledOnce()
  })

  it('reports when the user has no active tracking session', async () => {
    const { StopAttendanceTrackCommand } =
      await import('../../src/commands/chat/stop-attendance-track-command.js')
    const attendanceService = {
      stopTracking: vi.fn(() => null),
    } as unknown as AttendanceService
    const voiceStateUpdateHandler = {
      processCompletedSession: vi.fn(async () => undefined),
    } as unknown as VoiceStateUpdateHandler
    const command = new StopAttendanceTrackCommand(attendanceService, voiceStateUpdateHandler)

    await command.execute(
      { user: { id: 'tracker-1' } } as ChatInputCommandInteraction,
      { lang: 'en-US' } as EventData,
    )

    expect(voiceStateUpdateHandler.processCompletedSession).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledOnce()
    expect(sendMock.mock.calls[0]?.[2]).toBe(true)
  })
})
