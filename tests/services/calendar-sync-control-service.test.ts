import { type ShardingManager } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CalendarSyncControlService } from '../../src/services/calendar-sync-control-service.js'
import { CalendarSyncInProgressError } from '../../src/services/calendar-sync-runner.js'

describe('CalendarSyncControlService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects only when the shard serving the active sync dies', async () => {
    const deathListeners = new Map<number, () => void>()
    const targetSend = vi.fn().mockResolvedValue(undefined)
    const buildShard = (id: number, send: ReturnType<typeof vi.fn>) => {
      return {
        id,
        ready: true,
        on: vi.fn((event: string, listener: () => void) => {
          if (event === 'death') {
            deathListeners.set(id, listener)
          }
        }),
        send,
      }
    }
    const shardManager = {
      shards: new Map([
        [0, buildShard(0, targetSend)],
        [1, buildShard(1, vi.fn().mockResolvedValue(undefined))],
      ]),
      totalShards: 2,
    } as unknown as ShardingManager
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const service = new CalendarSyncControlService(shardManager)

    if (deathListeners.size !== 2) {
      throw new Error('Expected the control service to register a shard death listener.')
    }

    const request = service.sync()
    await vi.waitFor(() => expect(targetSend).toHaveBeenCalledOnce())
    deathListeners.get(1)?.()

    await expect(service.sync()).rejects.toBeInstanceOf(CalendarSyncInProgressError)

    deathListeners.get(0)?.()

    await expect(request).rejects.toThrow('Discord shard 0 died during calendar sync.')

    const nextRequest = service.sync()
    await vi.waitFor(() => expect(targetSend).toHaveBeenCalledTimes(2))
    deathListeners.get(0)?.()
    await expect(nextRequest).rejects.toThrow('Discord shard 0 died during calendar sync.')
  })
})
