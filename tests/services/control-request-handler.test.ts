import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CALENDAR_SYNC_MESSAGE_TYPE } from '../../src/models/control-api/calendar-sync.js'
import {
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
  type CommandRegistrationSummary,
} from '../../src/models/control-api/command-registration.js'
import { CalendarSyncInProgressError } from '../../src/services/calendar-sync-runner.js'
import { ControlRequestHandler } from '../../src/services/control-request-handler.js'
import { Logger } from '../../src/services/logger.js'

const commandSummary: CommandRegistrationSummary = {
  localAndRemote: ['help'],
  localOnly: [],
  remoteOnly: [],
}

function commandRequest(requestId: string, action: 'view' | 'register' = 'register') {
  return {
    type: COMMAND_REGISTRATION_MESSAGE_TYPE,
    kind: 'request' as const,
    requestId,
    action,
    args: [],
  }
}

describe('ControlRequestHandler', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(() => {})
    vi.spyOn(Logger, 'warn').mockImplementation(() => {})
    vi.spyOn(Logger, 'error').mockImplementation(() => {})
  })

  it('includes command state only in view responses', async () => {
    const sendResult = vi.fn(async () => {})
    const registerCommands = vi.fn(async () => commandSummary)
    const handler = new ControlRequestHandler(sendResult, registerCommands, {
      run: vi.fn(),
    })

    await handler.handle(commandRequest('view-request', 'view'))
    await handler.handle(commandRequest('register-request'))

    expect(registerCommands).toHaveBeenNthCalledWith(1, ['node', 'start-bot', 'commands', 'view'])
    expect(sendResult).toHaveBeenNthCalledWith(1, {
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: 'view-request',
      success: true,
      commands: commandSummary,
    })
    expect(sendResult).toHaveBeenNthCalledWith(2, {
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: 'register-request',
      success: true,
    })
  })

  it('reports a concurrent command request as in progress', async () => {
    let completeRegistration: ((summary: CommandRegistrationSummary) => void) | undefined
    const registration = new Promise<CommandRegistrationSummary>((resolve) => {
      completeRegistration = resolve
    })
    const sendResult = vi.fn(async () => {})
    const handler = new ControlRequestHandler(
      sendResult,
      vi.fn(async () => await registration),
      {
        run: vi.fn(),
      },
    )

    const firstRequest = handler.handle(commandRequest('first-request'))
    await vi.waitFor(() => expect(sendResult).not.toHaveBeenCalled())
    await handler.handle(commandRequest('second-request'))

    expect(sendResult).toHaveBeenCalledWith({
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: 'second-request',
      success: false,
      error: 'A command registration operation is already in progress.',
      errorCode: 'in-progress',
    })

    if (!completeRegistration) {
      throw new Error('Expected a pending command registration.')
    }
    completeRegistration(commandSummary)
    await firstRequest
  })

  it.each([
    [new CommandRegistrationNotFoundError('Missing command.'), 'not-found'],
    [new CommandRegistrationInvalidArgumentError('Missing argument.'), 'invalid-argument'],
  ] as const)('maps command errors to result codes', async (error, errorCode) => {
    const sendResult = vi.fn(async () => {})
    const handler = new ControlRequestHandler(
      sendResult,
      vi.fn(async () => {
        throw error
      }),
      { run: vi.fn() },
    )

    await handler.handle(commandRequest('failed-request'))

    expect(sendResult).toHaveBeenCalledWith({
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: 'failed-request',
      success: false,
      error: error.message,
      errorCode,
    })
  })

  it('reports a busy calendar sync distinctly', async () => {
    const sendResult = vi.fn(async () => {})
    const handler = new ControlRequestHandler(sendResult, vi.fn(), {
      run: vi.fn(async () => {
        throw new CalendarSyncInProgressError()
      }),
    })

    await handler.handle({
      type: CALENDAR_SYNC_MESSAGE_TYPE,
      kind: 'request',
      requestId: 'calendar-request',
    })

    expect(sendResult).toHaveBeenCalledWith({
      type: CALENDAR_SYNC_MESSAGE_TYPE,
      kind: 'result',
      requestId: 'calendar-request',
      success: false,
      error: 'A calendar sync is already in progress.',
      busy: true,
    })
  })
})
