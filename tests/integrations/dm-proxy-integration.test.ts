import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/services/index.js', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const API_KEY = 'test-api-key'
const USER_ID = '123456789012345678'

const DELIVERED = { ok: true, code: null, message: '' }

async function buildApp(
  broadcastEval: (...args: unknown[]) => unknown = vi.fn().mockResolvedValue(DELIVERED),
): Promise<{ app: Express; broadcastEval: ReturnType<typeof vi.fn> }> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { DmProxyIntegration } = await import('../../src/integrations/dm-proxy-integration.js')
  const { Api } = await import('../../src/models/api.js')

  const shardManager = { broadcastEval } as unknown as import('discord.js').ShardingManager
  const integration = new DmProxyIntegration()
  const controller = new IntegrationsController([integration], shardManager)
  const api = new Api([controller])
  return { app: api.app, broadcastEval: broadcastEval as ReturnType<typeof vi.fn> }
}

function post(app: Express, body: object, auth: string | null = API_KEY) {
  const req = request(app).post('/integrations/send-dm').send(body)
  if (auth !== null) req.set('Authorization', auth)
  return req
}

describe('DmProxyIntegration', () => {
  beforeEach(() => {
    process.env.INTEGRATION_DM_PROXY = API_KEY
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.INTEGRATION_DM_PROXY
    vi.restoreAllMocks()
  })

  it('delivers a DM and pins the eval to shard 0', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'Reminder: canvass at noon.' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const options = broadcastEval.mock.calls[0]![1] as {
      shard: number
      context: { userId: string; message: string }
    }
    expect(options.shard).toBe(0)
    expect(options.context).toEqual({ userId: USER_ID, message: 'Reminder: canvass at noon.' })
  })

  it('unwraps an array eval result (unpinned broadcastEval shape)', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([DELIVERED])
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
  })

  it('returns 200 delivered:false when the user has DMs closed (50007)', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 50007, message: 'Cannot send messages to this user' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: false, reason: 'dms_closed' })
  })

  it('returns 404 for an unknown user (10013)', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 10013, message: 'Unknown User' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: true, delivered: false, reason: 'unknown_user' })
  })

  it('returns 502 with the code for other Discord errors', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 40003, message: 'rate limited' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({
      error: true,
      delivered: false,
      reason: 'discord_error',
      code: 40003,
      message: 'rate limited',
    })
  })

  it('returns 500 when broadcastEval itself rejects (controller catchall)', async () => {
    const broadcastEval = vi.fn().mockRejectedValue(new Error('discord exploded'))
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'discord exploded' })
  })

  it('rejects a missing userId', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { message: 'hello' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/userId must be a string/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects a numeric userId (JSON numbers lose snowflake precision)', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: 123456, message: 'hello' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/userId must be a string/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects a malformed userId', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    for (const userId of ['abc', '123', '1234567890123456789012']) {
      const res = await post(app, { userId, message: 'hello' })
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/snowflake/i)
    }
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects a missing message', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/message must be a string/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects an empty message', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: '' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/must not be empty/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects a message longer than 2000 characters', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'x'.repeat(2001) })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/at most 2000 characters/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('accepts a message of exactly 2000 characters', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'x'.repeat(2000) })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
  })
})
