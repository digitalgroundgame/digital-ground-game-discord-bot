import { describe, expect, it } from 'vitest'

import {
  CALENDAR_SYNC_MESSAGE_TYPE,
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  isCalendarSyncRequest,
  isCalendarSyncResult,
  isCommandRegistrationRequest,
  isCommandRegistrationResult,
} from '../src/command-registration-control.js'

describe('command registration control messages', () => {
  it('recognizes a registration request', () => {
    expect(
      isCommandRegistrationRequest({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'request',
        requestId: 'request-1',
        action: 'register',
        args: [],
      }),
    ).toBe(true)
  })

  it('rejects malformed registration requests', () => {
    expect(isCommandRegistrationRequest({ type: COMMAND_REGISTRATION_MESSAGE_TYPE })).toBe(false)
    expect(
      isCommandRegistrationRequest({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
      }),
    ).toBe(false)
  })

  it('recognizes successful and failed registration results', () => {
    expect(
      isCommandRegistrationResult({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: true,
      }),
    ).toBe(true)
    expect(
      isCommandRegistrationResult({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: false,
        error: 'Request failed',
      }),
    ).toBe(true)
  })

  it('recognizes calendar sync control messages', () => {
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
})
