import { type ShardingManager } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CalendarSyncControlService } from '../../src/services/calendar-sync-control-service.js'

describe('CalendarSyncControlService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects the active request and permits another sync when the shard dies', async () => {
    let deathListener: (() => void) | undefined
    const send = vi.fn().mockResolvedValue(undefined)
    const shard = {
      ready: true,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === 'death') {
          deathListener = listener
        }
      }),
      send,
    }
    const shardManager = {
      shards: new Map([[0, shard]]),
      totalShards: 1,
    } as unknown as ShardingManager
    vi.stubEnv('DISCORD_GUILD_ID', '1')
    const service = new CalendarSyncControlService(shardManager)

    if (!deathListener) {
      throw new Error('Expected the control service to register a shard death listener.')
    }

    const request = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    deathListener()

    await expect(request).rejects.toThrow('Discord shard died during calendar sync.')

    const nextRequest = service.sync()
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    deathListener()
    await expect(nextRequest).rejects.toThrow('Discord shard died during calendar sync.')
  })
})
