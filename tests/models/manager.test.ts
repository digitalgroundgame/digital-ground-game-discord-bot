import { type ShardingManager } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Manager } from '../../src/models/manager.js'
import { type JobService, Logger } from '../../src/services/index.js'

function createMockShard(): { kill: ReturnType<typeof vi.fn> } {
  return { kill: vi.fn() }
}

function createMockShardManager(
  spawn: ReturnType<typeof vi.fn>,
  shards: Map<number, { kill: ReturnType<typeof vi.fn> }> = new Map(),
): ShardingManager {
  return {
    shardList: [0],
    totalShards: 1,
    on: vi.fn(),
    spawn,
    shards,
  } as unknown as ShardingManager
}

function createMockJobService(): JobService {
  return { start: vi.fn() } as unknown as JobService
}

describe('Manager', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(() => {})
    vi.spyOn(Logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts jobs after a successful shard spawn', async () => {
    const spawn = vi.fn().mockResolvedValue(new Map())
    const shardManager = createMockShardManager(spawn)
    const jobService = createMockJobService()
    const manager = new Manager(shardManager, jobService)

    await manager.start()

    expect(spawn).toHaveBeenCalledOnce()
    expect(jobService.start).toHaveBeenCalledOnce()
  })

  it('rethrows a shard spawn failure and does not start jobs', async () => {
    const error = new Error('spawn failed')
    const spawn = vi.fn().mockRejectedValue(error)
    const shardManager = createMockShardManager(spawn)
    const jobService = createMockJobService()
    const manager = new Manager(shardManager, jobService)

    await expect(manager.start()).rejects.toBe(error)

    expect(jobService.start).not.toHaveBeenCalled()
  })

  it('kills partially spawned shards when spawning fails', async () => {
    const error = new Error('spawn timed out')
    const spawn = vi.fn().mockRejectedValue(error)
    const shard = createMockShard()
    const shardManager = createMockShardManager(spawn, new Map([[0, shard]]))
    const manager = new Manager(shardManager, createMockJobService())

    await expect(manager.start()).rejects.toBe(error)

    expect(shard.kill).toHaveBeenCalledOnce()
  })
})
