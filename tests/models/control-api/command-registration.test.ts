import { describe, expect, it } from 'vitest'

import {
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  isCommandRegistrationRequest,
  isCommandRegistrationResult,
} from '../../../src/models/control-api/command-registration.js'

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

  it('recognizes successful and known-error registration results', () => {
    expect(
      isCommandRegistrationResult({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: true,
      }),
    ).toBe(true)

    for (const errorCode of ['not-found', 'invalid-argument', 'in-progress']) {
      expect(
        isCommandRegistrationResult({
          type: COMMAND_REGISTRATION_MESSAGE_TYPE,
          kind: 'result',
          requestId: 'request-1',
          success: false,
          error: 'Request failed',
          errorCode,
        }),
      ).toBe(true)
    }
  })

  it('rejects an unknown registration error code', () => {
    expect(
      isCommandRegistrationResult({
        type: COMMAND_REGISTRATION_MESSAGE_TYPE,
        kind: 'result',
        requestId: 'request-1',
        success: false,
        error: 'Request failed',
        errorCode: 'unknown',
      }),
    ).toBe(false)
  })
})
