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
  listener: (message: CommandRegistrationResult) => void
  send: ReturnType<typeof vi.fn>
  service: CommandRegistrationControlService
}

function buildHarness(): ControlServiceHarness {
  let messageListener: ((message: CommandRegistrationResult) => void) | undefined
  const send = vi.fn().mockResolvedValue(undefined)
  const shard = {
    ready: true,
    on: vi.fn((_event: string, listener: (message: CommandRegistrationResult) => void) => {
      messageListener = listener
    }),
    send,
  }
  const shardManager = {
    shards: new Map([[0, shard]]),
  } as unknown as ShardingManager
  const service = new CommandRegistrationControlService(shardManager)

  if (!messageListener) {
    throw new Error('Expected the control service to register a shard message listener.')
  }

  return { listener: messageListener, send, service }
}

describe('CommandRegistrationControlService', () => {
  it.each([
    ['not-found', CommandRegistrationNotFoundError],
    ['invalid-argument', CommandRegistrationInvalidArgumentError],
  ] as const)('reconstructs a %s shard error', async (errorCode, ErrorType) => {
    const { listener, send, service } = buildHarness()
    const request = service.request('delete', ['missing'])

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const sentRequest = send.mock.calls[0]?.[0] as CommandRegistrationRequest
    listener({
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'result',
      requestId: sentRequest.requestId,
      success: false,
      error: 'Command registration failed.',
      errorCode,
    })

    await expect(request).rejects.toBeInstanceOf(ErrorType)
  })
})
