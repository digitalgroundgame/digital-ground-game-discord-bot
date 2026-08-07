import { type ShardingManager } from 'discord.js'
import { describe, expect, it, vi } from 'vitest'

import {
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
  type CommandRegistrationRequest,
  type CommandRegistrationResult,
} from '../../src/models/control-api/command-registration.js'
import {
  CommandRegistrationControlService,
  CommandRegistrationInProgressError,
} from '../../src/services/command-registration-control-service.js'

interface ControlServiceHarness {
  deathListeners: Map<number, () => void>
  messageListeners: Map<number, (message: CommandRegistrationResult) => void>
  send: ReturnType<typeof vi.fn>
  service: CommandRegistrationControlService
}

function buildHarness(): ControlServiceHarness {
  const deathListeners = new Map<number, () => void>()
  const messageListeners = new Map<number, (message: CommandRegistrationResult) => void>()
  const sends = new Map<number, ReturnType<typeof vi.fn>>()
  const buildShard = (id: number) => {
    const send = vi.fn().mockResolvedValue(undefined)
    sends.set(id, send)
    return {
      id,
      ready: true,
      on: vi.fn(
        (
          event: string,
          listener: ((message: CommandRegistrationResult) => void) | (() => void),
        ) => {
          if (event === 'message') {
            messageListeners.set(id, listener as (message: CommandRegistrationResult) => void)
          } else if (event === 'death') {
            deathListeners.set(id, listener as () => void)
          }
        },
      ),
      send,
    }
  }
  const shardManager = {
    shards: new Map([
      [0, buildShard(0)],
      [1, buildShard(1)],
    ]),
  } as unknown as ShardingManager
  const service = new CommandRegistrationControlService(shardManager)

  const send = sends.get(0)
  if (!(send && deathListeners.size === 2 && messageListeners.size === 2)) {
    throw new Error('Expected the control service to register shard listeners.')
  }

  return { deathListeners, messageListeners, send, service }
}

describe('CommandRegistrationControlService', () => {
  it.each([
    ['not-found', CommandRegistrationNotFoundError],
    ['invalid-argument', CommandRegistrationInvalidArgumentError],
    ['in-progress', CommandRegistrationInProgressError],
  ] as const)('reconstructs a %s shard error', async (errorCode, ErrorType) => {
    const { messageListeners, send, service } = buildHarness()
    const request = service.request('delete', ['missing'])

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const sentRequest = send.mock.calls[0]?.[0] as CommandRegistrationRequest
    messageListeners.get(0)?.({
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: sentRequest.requestId,
      success: false,
      error: 'Command registration failed.',
      errorCode,
    })

    await expect(request).rejects.toBeInstanceOf(ErrorType)
  })

  it('rejects only when the shard serving the active request dies', async () => {
    const { deathListeners, send, service } = buildHarness()
    const request = service.request('register')

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    deathListeners.get(1)?.()

    await expect(service.request('register')).rejects.toBeInstanceOf(
      CommandRegistrationInProgressError,
    )

    deathListeners.get(0)?.()

    await expect(request).rejects.toThrow('Discord shard 0 died during command registration.')

    const nextRequest = service.request('register')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    deathListeners.get(0)?.()
    await expect(nextRequest).rejects.toThrow('Discord shard 0 died during command registration.')
  })
})
