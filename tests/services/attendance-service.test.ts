import { describe, expect, it } from 'vitest'

import { AttendanceService } from '../../src/services/attendance-service.js'

describe('AttendanceService', () => {
  it('returns and removes a completed session when tracking is stopped', () => {
    const service = new AttendanceService()
    service.startTracking('tracker-1', 'channel-1', 'guild-1', 'Strategy Room', [
      { id: 'tracker-1', displayName: 'Tracker' },
      { id: 'attendee-1', displayName: 'Attendee' },
    ])

    const result = service.stopTracking('tracker-1')

    expect(result).toMatchObject({
      userId: 'tracker-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      channelName: 'Strategy Room',
      entries: [
        { id: 'tracker-1', displayName: 'Tracker' },
        { id: 'attendee-1', displayName: 'Attendee' },
      ],
    })
    expect(service.isTracking('tracker-1')).toBe(false)
    expect(service.stopTracking('tracker-1')).toBeNull()
  })
})
