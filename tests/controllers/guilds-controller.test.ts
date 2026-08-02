import { type ShardingManager } from 'discord.js'
import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GuildsController } from '../../src/controllers/guilds-controller.js'
import { Api } from '../../src/models/api.js'

const SECRET = 'test-api-secret'

function buildApp(): Express {
  const shardManager = {
    broadcastEval: vi.fn(async () => [
      ['111111111111111111', '222222222222222222'],
      ['222222222222222222'],
    ]),
  } as unknown as ShardingManager
  const api = new Api([new GuildsController(shardManager)])
  return api.app
}

describe('GuildsController', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_BOT_API_SECRET', SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/guilds')

    expect(res.status).toBe(401)
  })

  it('returns 401 when the token is wrong but the same length as the secret', async () => {
    const res = await request(buildApp()).get('/guilds').set('Authorization', 'nope-api-secret')

    expect(res.status).toBe(401)
  })

  it('returns 401 when the token is a different length from the secret', async () => {
    const res = await request(buildApp()).get('/guilds').set('Authorization', 'wrong-secret')

    expect(res.status).toBe(401)
  })

  it('returns the deduplicated guild ids with the correct token', async () => {
    const res = await request(buildApp()).get('/guilds').set('Authorization', SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ guilds: ['111111111111111111', '222222222222222222'] })
  })

  it('refuses to mount the controller when no secret is configured', () => {
    vi.stubEnv('DISCORD_BOT_API_SECRET', '')

    expect(() => buildApp()).toThrow(/auth token/)
  })
})
