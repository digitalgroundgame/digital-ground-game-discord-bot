import { type ShardingManager } from 'discord.js'
import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShardsController } from '../../src/controllers/shards-controller.js'
import { Api } from '../../src/models/api.js'

const SECRET = 'test-api-secret'

type FakeShard = {
  id: number
  ready: boolean
  fetchClientValue: ReturnType<typeof vi.fn>
}

function makeShardManager(): { manager: ShardingManager; broadcastEval: ReturnType<typeof vi.fn> } {
  const shard: FakeShard = {
    id: 0,
    ready: true,
    fetchClientValue: vi.fn(async () => 123_456),
  }
  const broadcastEval = vi.fn(async () => [])
  const manager = {
    shards: {
      size: 1,
      map: <T>(fn: (shard: FakeShard) => T): T[] => [fn(shard)],
    },
    broadcastEval,
  } as unknown as ShardingManager
  return { manager, broadcastEval }
}

function buildApp(manager?: ShardingManager): Express {
  const shardManager = manager ?? makeShardManager().manager
  const api = new Api([new ShardsController(shardManager)])
  return api.app
}

describe('ShardsController', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_BOT_API_SECRET', SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 for GET /shards without the Authorization header', async () => {
    const res = await request(buildApp()).get('/shards')

    expect(res.status).toBe(401)
  })

  it('returns 401 for GET /shards with a wrong token of the same length as the secret', async () => {
    const res = await request(buildApp()).get('/shards').set('Authorization', 'nope-api-secret')

    expect(res.status).toBe(401)
  })

  it('returns 401 for PUT /shards/presence without the Authorization header', async () => {
    const res = await request(buildApp()).put('/shards/presence').send({})

    expect(res.status).toBe(401)
  })

  it('returns 401 for PUT /shards/presence with a wrong token', async () => {
    const res = await request(buildApp())
      .put('/shards/presence')
      .set('Authorization', 'nope-api-secret')
      .send({ type: 'Playing', name: 'a test status', url: 'https://example.com/' })

    expect(res.status).toBe(401)
  })

  it('returns shard stats with the correct token', async () => {
    const res = await request(buildApp()).get('/shards').set('Authorization', SECRET)

    expect(res.status).toBe(200)
    expect(res.body.shards).toEqual([{ id: 0, ready: true, error: false, uptimeSecs: 123 }])
    expect(res.body.stats.shardCount).toBe(1)
  })

  it('sets shard presences with the correct token', async () => {
    const { manager, broadcastEval } = makeShardManager()

    const res = await request(buildApp(manager))
      .put('/shards/presence')
      .set('Authorization', SECRET)
      .send({ type: 'Playing', name: 'a test status', url: 'https://example.com/' })

    expect(res.status).toBe(200)
    expect(broadcastEval).toHaveBeenCalledOnce()
  })
})
