import { type ShardingManager } from 'discord.js'
import { describe, expect, it, vi } from 'vitest'

import {
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
  type CommandRegistrationRequest,
  type CommandRegistrationResult,
} from '../../src/command-registration-control.js'
import { CommandRegistrationControlService } from '../../src/services/command-registration-control-service.js'

interface ControlServiceHarness {
  deathListener: () => void
  messageListener: (message: CommandRegistrationResult) => void
  send: ReturnType<typeof vi.fn>
  service: CommandRegistrationControlService
}

function buildHarness(): ControlServiceHarness {
  let deathListener: (() => void) | undefined
  let messageListener: ((message: CommandRegistrationResult) => void) | undefined
  const send = vi.fn().mockResolvedValue(undefined)
  const shard = {
    ready: true,
    on: vi.fn((event: string, listener: (message: CommandRegistrationResult) => void) => {
      if (event === 'message') {
        messageListener = listener
      } else if (event === 'death') {
        deathListener = listener
      }
    }),
    send,
  }
  const shardManager = {
    shards: new Map([[0, shard]]),
  } as unknown as ShardingManager
  const service = new CommandRegistrationControlService(shardManager)

  if (!(deathListener && messageListener)) {
    throw new Error('Expected the control service to register shard listeners.')
  }

  return { deathListener, messageListener, send, service }
}

describe('CommandRegistrationControlService', () => {
  it.each([
    ['not-found', CommandRegistrationNotFoundError],
    ['invalid-argument', CommandRegistrationInvalidArgumentError],
  ] as const)('reconstructs a %s shard error', async (errorCode, ErrorType) => {
    const { messageListener, send, service } = buildHarness()
    const request = service.request('delete', ['missing'])

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const sentRequest = send.mock.calls[0]?.[0] as CommandRegistrationRequest
    messageListener({
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: sentRequest.requestId,
      success: false,
      error: 'Command registration failed.',
      errorCode,
    })

    await expect(request).rejects.toBeInstanceOf(ErrorType)
  })

  it('rejects the active request and permits another request when the shard dies', async () => {
    const { deathListener, send, service } = buildHarness()
    const request = service.request('register')

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    deathListener()

    await expect(request).rejects.toThrow('Discord shard died during command registration.')

    const nextRequest = service.request('register')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    deathListener()
    await expect(nextRequest).rejects.toThrow('Discord shard died during command registration.')
  })
})
