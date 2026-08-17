import { type ShardingManager } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CALENDAR_SYNC_MESSAGE_TYPE,
  CalendarSyncInProgressError,
  type CalendarSyncRequest,
  type CalendarSyncResult,
} from '../../src/models/control-api/calendar-sync.js'
import { CalendarSyncControlService } from '../../src/services/calendar-sync-control-service.js'

interface ControlServiceHarness {
  deathListeners: Map<number, () => void>
  messageListeners: Map<number, (message: CalendarSyncResult) => void>
  send: ReturnType<typeof vi.fn>
  service: CalendarSyncControlService
}

interface HarnessOptions {
  targetReady?: boolean
  totalShards?: unknown
}

function buildHarness({
  targetReady = true,
  totalShards = 2,
}: HarnessOptions = {}): ControlServiceHarness {
  const deathListeners = new Map<number, () => void>()
  const messageListeners = new Map<number, (message: CalendarSyncResult) => void>()
  const sends = new Map<number, ReturnType<typeof vi.fn>>()
  const buildShard = (id: number) => {
    const send = vi.fn().mockResolvedValue(undefined)
    sends.set(id, send)
    return {
      id,
      ready: id === 0 ? targetReady : true,
      on: vi.fn(
        (event: string, listener: ((message: CalendarSyncResult) => void) | (() => void)) => {
          if (event === 'message') {
            messageListeners.set(id, listener as (message: CalendarSyncResult) => void)
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
    totalShards,
  } as unknown as ShardingManager
  const service = new CalendarSyncControlService(shardManager)

  const send = sends.get(0)
  if (!(send && deathListeners.size === 2 && messageListeners.size === 2)) {
    throw new Error('Expected the control service to register shard listeners.')
  }

  return { deathListeners, messageListeners, send, service }
}

async function sentRequest(send: ReturnType<typeof vi.fn>): Promise<CalendarSyncRequest> {
  await vi.waitFor(() => expect(send).toHaveBeenCalled())
  return send.mock.calls.at(-1)?.[0] as CalendarSyncRequest
}

function result(
  requestId: string,
  overrides: Partial<CalendarSyncResult> = {},
): CalendarSyncResult {
  return {
    type: CALENDAR_SYNC_MESSAGE_TYPE,
    kind: 'result',
    requestId,
    success: true,
    ...overrides,
  }
}

describe('CalendarSyncControlService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resolves when the shard reports a successful sync', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { messageListeners, send, service } = buildHarness()
    const sync = service.sync()
    const request = await sentRequest(send)

    messageListeners.get(0)?.(result(request.requestId))

    await expect(sync).resolves.toBeUndefined()
  })

  it('reconstructs an in-progress error from a busy shard result', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { messageListeners, send, service } = buildHarness()
    const sync = service.sync()
    const request = await sentRequest(send)

    messageListeners.get(0)?.(
      result(request.requestId, {
        success: false,
        busy: true,
        error: 'A calendar sync is already in progress.',
      }),
    )

    await expect(sync).rejects.toBeInstanceOf(CalendarSyncInProgressError)
  })

  it('reports a generic shard error', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { messageListeners, send, service } = buildHarness()
    const sync = service.sync()
    const request = await sentRequest(send)

    messageListeners.get(0)?.(
      result(request.requestId, { success: false, error: 'Calendar provider failed.' }),
    )

    await expect(sync).rejects.toThrow('Calendar provider failed.')
  })

  it('ignores a result with a stale request ID', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { messageListeners, send, service } = buildHarness()
    const sync = service.sync()
    const request = await sentRequest(send)

    messageListeners.get(0)?.(result('stale-request'))

    await expect(service.sync()).rejects.toBeInstanceOf(CalendarSyncInProgressError)
    messageListeners.get(0)?.(result(request.requestId))
    await expect(sync).resolves.toBeUndefined()
  })

  it('rejects only when the shard serving the active sync dies', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { deathListeners, send, service } = buildHarness()
    const request = service.sync()

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    deathListeners.get(1)?.()

    await expect(service.sync()).rejects.toBeInstanceOf(CalendarSyncInProgressError)

    deathListeners.get(0)?.()

    await expect(request).rejects.toThrow('Discord shard 0 died during calendar sync.')

    const nextRequest = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    deathListeners.get(0)?.()
    await expect(nextRequest).rejects.toThrow('Discord shard 0 died during calendar sync.')
  })

  it('rejects when DISCORD_GUILD_ID is missing', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '')
    const { service } = buildHarness()

    await expect(service.sync()).rejects.toThrow(
      'DISCORD_GUILD_ID is required to run calendar sync.',
    )
  })

  it('rejects when the shard count is unavailable', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { service } = buildHarness({ totalShards: 'auto' })

    await expect(service.sync()).rejects.toThrow('The Discord shard count is not available.')
  })

  it('rejects when the calendar guild shard is not ready', async () => {
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const { service } = buildHarness({ targetReady: false })

    await expect(service.sync()).rejects.toThrow(
      'Discord shard 0 for the calendar guild is not ready.',
    )
  })
})
