import { type Client, type User, type VoiceState } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AttendanceService } from '../../src/services/attendance-service.js'
import { type CrmService } from '../../src/services/crm-service.js'

const sendMock = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('../../src/utils/message-utils.js', () => ({
  MessageUtils: {
    send: sendMock,
  },
}))

describe('VoiceStateUpdateHandler', () => {
  beforeEach(() => {
    sendMock.mockClear()
  })

  it('sends the attendee list after successfully staging attendance in the CRM', async () => {
    const { VoiceStateUpdateHandler } =
      await import('../../src/events/voice-state-update-handler.js')
    const user = {} as User
    const guild = {
      scheduledEvents: {
        cache: new Map(),
        fetch: vi.fn(async () => new Map()),
      },
    }
    const client = {
      guilds: {
        fetch: vi.fn(async () => guild),
      },
      users: {
        fetch: vi.fn(async () => user),
      },
    } as unknown as Client
    const attendanceService = {
      handleVoiceStateUpdate: vi.fn(() => ({
        userId: 'tracker-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        channelName: 'Strategy Room',
        sessionId: 'session-1',
        defaultEventName: 'Strategy Room - May 11, 2026 10:00 PM UTC',
        entries: [
          { id: 'user-1', displayName: 'Ada Lovelace' },
          { id: 'user-2', displayName: 'Grace Hopper' },
        ],
      })),
    } as unknown as AttendanceService
    const crmService = {
      recordAttendance: vi.fn(async () => ({
        event_id: 'session-1',
        total_received: 2,
        unlinked_participants: [],
      })),
    } as unknown as CrmService

    const handler = new VoiceStateUpdateHandler(attendanceService, crmService, client)

    await handler.process({} as VoiceState, {} as VoiceState)

    expect(crmService.recordAttendance).toHaveBeenCalledWith({
      event_id: 'session-1',
      event_name: 'Strategy Room - May 11, 2026 10:00 PM UTC',
      event_tracker_discord_id: 'tracker-1',
      participants: [
        { discord_id: 'user-1', discord_name: 'Ada Lovelace', status: 'ATTENDED' },
        { discord_id: 'user-2', discord_name: 'Grace Hopper', status: 'ATTENDED' },
      ],
    })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const content = sendMock.mock.calls[0]?.[1] as string
    expect(content).toContain('Attendance staged in CRM')
    expect(content).toContain('Event: **Strategy Room - May 11, 2026 10:00 PM UTC**')
    expect(content).toContain('Channel: Strategy Room')
    expect(content).toContain('Date:')
    const rosterBlock = content.match(/```\n([\s\S]*)\n```/)?.[1]
    expect(rosterBlock).not.toContain('# Attendance of Strategy Room')
    expect(rosterBlock).not.toContain('Date:')
    expect(rosterBlock).not.toContain('Subject:')
    expect(rosterBlock).toContain('- Ada Lovelace')
    expect(rosterBlock).toContain('- Grace Hopper')
  })

  it('sends event details and a roster-only attendance list when CRM staging fails', async () => {
    const { VoiceStateUpdateHandler } =
      await import('../../src/events/voice-state-update-handler.js')
    const user = {} as User
    const guild = {
      scheduledEvents: {
        cache: new Map(),
        fetch: vi.fn(async () => new Map()),
      },
    }
    const client = {
      guilds: {
        fetch: vi.fn(async () => guild),
      },
      users: {
        fetch: vi.fn(async () => user),
      },
    } as unknown as Client
    const attendanceService = {
      handleVoiceStateUpdate: vi.fn(() => ({
        userId: 'tracker-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        channelName: 'Strategy Room',
        sessionId: 'session-1',
        defaultEventName: 'Strategy Room - May 11, 2026 10:00 PM UTC',
        entries: [
          { id: 'user-1', displayName: 'Ada Lovelace' },
          { id: 'user-2', displayName: 'Grace Hopper' },
        ],
      })),
    } as unknown as AttendanceService
    const crmService = {
      recordAttendance: vi.fn(async () => {
        throw new Error('CRM unavailable')
      }),
    } as unknown as CrmService

    const handler = new VoiceStateUpdateHandler(attendanceService, crmService, client)

    await handler.process({} as VoiceState, {} as VoiceState)

    expect(sendMock).toHaveBeenCalledTimes(3)
    const warningContent = sendMock.mock.calls[0]?.[1] as string
    expect(warningContent).toContain('Failed to sync attendance to the CRM')
    expect(warningContent).toContain('Event: **Strategy Room - May 11, 2026 10:00 PM UTC**')
    expect(warningContent).toContain('Channel: Strategy Room')
    expect(warningContent).toContain('Date:')

    const rosterContent = sendMock.mock.calls[1]?.[1] as string
    const rosterBlock = rosterContent.match(/```\n([\s\S]*)\n```/)?.[1]
    expect(rosterBlock).not.toContain('# Attendance of Strategy Room')
    expect(rosterBlock).not.toContain('Date:')
    expect(rosterBlock).not.toContain('Subject:')
    expect(rosterBlock).toContain('- Ada Lovelace')
    expect(rosterBlock).toContain('- Grace Hopper')

    expect(sendMock.mock.calls[2]?.[1]).toMatchObject({
      content: '**Raw CRM payload (for manual replay):**',
      files: expect.any(Array),
    })
  })
})
