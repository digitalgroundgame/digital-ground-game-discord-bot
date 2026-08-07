import { describe, expect, it } from 'vitest'

import {
  CALENDAR_SYNC_MESSAGE_TYPE,
  isCalendarSyncRequest,
  isCalendarSyncResult,
} from '../../../src/models/control-api/calendar-sync.js'

describe('calendar sync control messages', () => {
  it('recognizes calendar sync requests and results', () => {
    expect(
      isCalendarSyncRequest({
        type: CALENDAR_SYNC_MESSAGE_TYPE,
        kind: 'request',
        requestId: 'request-1',
      }),
    ).toBe(true)
    expect(
      isCalendarSyncResult({
        type: CALENDAR_SYNC_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: true,
      }),
    ).toBe(true)
  })

  it('rejects malformed calendar sync messages', () => {
    expect(isCalendarSyncRequest({ type: CALENDAR_SYNC_MESSAGE_TYPE })).toBe(false)
    expect(
      isCalendarSyncResult({
        type: CALENDAR_SYNC_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: false,
        busy: 'yes',
      }),
    ).toBe(false)
  })
})
