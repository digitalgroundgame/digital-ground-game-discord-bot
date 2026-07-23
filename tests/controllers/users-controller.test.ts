import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerError = vi.fn()
vi.mock('../../src/services/index.js', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerError,
  },
}))

const GUILD_ID = '111222333444555666'
const USER_ID = '123456789012345678'

const sampleUser = {
  userId: USER_ID,
  username: 'testuser',
  displayName: 'Test User',
  joinedAt: '2024-01-01T00:00:00.000Z',
  roles: [{ key: 'ADMIN', id: 'admin-id', name: 'Admin' }],
  access: [
    {
      provider: 'google',
      username: 'test@example.com',
      displayName: 'Test User',
      linkedAt: '2024-02-01T00:00:00.000Z',
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
    process.env.DISCORD_GUILD_ID = GUILD_ID
  })

  afterEach(() => {
    delete process.env.DISCORD_GUILD_ID
    vi.restoreAllMocks()
  })

  it('returns the user info from the shard that owns the guild', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([null, sampleUser])
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(sampleUser)
  })

  it('passes the env guild id and path user id to the eval context', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([sampleUser])
    const app = await buildApp(broadcastEval)

    await request(app).get(`/users/${USER_ID}`)

    expect(broadcastEval).toHaveBeenCalledTimes(1)
    expect(broadcastEval.mock.calls[0][1]).toEqual({
      context: { guildId: GUILD_ID, userId: USER_ID },
    })
  })

  it('returns 404 when the user is not a member of the guild', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([null, null])
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`)

    expect(res.status).toBe(404)
  })

  it('returns 500 and does not query shards when DISCORD_GUILD_ID is unset', async () => {
    delete process.env.DISCORD_GUILD_ID
    const broadcastEval = vi.fn()
    const app = await buildApp(broadcastEval)

    const res = await request(app).get(`/users/${USER_ID}`)

    expect(res.status).toBe(500)
    expect(broadcastEval).not.toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('DISCORD_GUILD_ID'))
  })
})
