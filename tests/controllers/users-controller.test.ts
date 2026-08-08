import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerError = vi.fn()
const loggerWarn = vi.fn()
vi.mock('../../src/services/index.js', () => ({
  Logger: {
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  },
}))

const GUILD_ID = '111222333444555666'
const USER_ID = '123456789012345678'
const API_SECRET = 'test-secret'

const sampleUser = {
  userId: USER_ID,
  username: 'testuser',
  displayName: 'Test User',
  avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc.png',
  joinedAt: '2024-01-01T00:00:00.000Z',
  roles: [{ key: 'ADMIN', id: 'admin-id', name: 'Admin' }],
  access: [
    {
      provider: 'google',
      externalId: 'test@example.com',
      displayName: 'Test User',
      linkedAt: '2024-02-01T00:00:00.000Z',
      grants: [
        {
          team: 'welcome',
          groupAddress: 'welcome@example.com',
          grantedAt: '2024-03-01T00:00:00.000Z',
        },
      ],
    },
  ],
}

async function buildApp(broadcastEval: ReturnType<typeof vi.fn>): Promise<Express> {
  const { UsersController } = await import('../../src/controllers/users-controller.js')
  const { Api } = await import('../../src/models/api.js')
  const shardManager = { broadcastEval } as unknown as import('discord.js').ShardingManager
  const controller = new UsersController(shardManager)
  const api = new Api([controller])
  return api.app
}

describe('UsersController', () => {
  beforeEach(() => {
    vi.resetModules()
    loggerError.mockClear()
    loggerWarn.mockClear()
    process.env.DISCORD_GUILD_ID = GUILD_ID
    // Pinned so `Api.setupControllers` actually installs `checkAuth`; left
    // unset, the auth guard on this PII endpoint would go untested.
    process.env.DISCORD_BOT_API_SECRET = API_SECRET
  })

  afterEach(() => {
    delete process.env.DISCORD_GUILD_ID
    delete process.env.DISCORD_BOT_API_SECRET
    vi.restoreAllMocks()
  })

  it('returns the user info from the shard that owns the guild', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([null, sampleUser])
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`).set('Authorization', API_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(sampleUser)
  })

  it('passes the env guild id and path user id to the eval context', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([sampleUser])
    const app = await buildApp(broadcastEval)

    await request(app).get(`/users/${USER_ID}`).set('Authorization', API_SECRET)

    expect(broadcastEval).toHaveBeenCalledTimes(1)
    expect(broadcastEval.mock.calls[0][1]).toEqual({
      context: { guildId: GUILD_ID, userId: USER_ID },
    })
  })

  it('returns 404 and warns when no shard resolved the member', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([null, null])
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`).set('Authorization', API_SECRET)

    expect(res.status).toBe(404)
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining(USER_ID))
  })

  it('returns 401 and does not query shards without a valid token', async () => {
    const broadcastEval = vi.fn()
    const app = await buildApp(broadcastEval)

    const missing = await request(app).get(`/users/${USER_ID}`)
    const wrong = await request(app).get(`/users/${USER_ID}`).set('Authorization', 'nope')

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('returns 400 and does not query shards for a non-snowflake user id', async () => {
    const broadcastEval = vi.fn()
    const app = await buildApp(broadcastEval)

    for (const id of ['derrick', `foo${USER_ID}bar`, '123']) {
      const res = await request(app).get(`/users/${id}`).set('Authorization', API_SECRET)
      expect(res.status).toBe(400)
    }
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('returns 503 when the broadcast fails instead of leaking the error', async () => {
    const broadcastEval = vi.fn().mockRejectedValue(new Error('shard 0 is not ready'))
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`).set('Authorization', API_SECRET)

    expect(res.status).toBe(503)
    expect(res.text).not.toContain('shard 0 is not ready')
    expect(loggerError).toHaveBeenCalled()
  })

  it('returns 500 and does not query shards when DISCORD_GUILD_ID is unset', async () => {
    delete process.env.DISCORD_GUILD_ID
    const broadcastEval = vi.fn()
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`).set('Authorization', API_SECRET)

    expect(res.status).toBe(500)
    expect(broadcastEval).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('DISCORD_GUILD_ID'))
  })
})
