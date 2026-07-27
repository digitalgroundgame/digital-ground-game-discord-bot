import { Collection } from 'discord.js'
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

const DELIVERED = { ok: true }

async function buildApp(
  broadcastEval: (...args: unknown[]) => unknown = vi.fn().mockResolvedValue(DELIVERED),
  shards: Collection<number, { ready: boolean; id: number }> = new Collection([
    [0, { ready: true, id: 0 }],
  ]),
): Promise<{ app: Express; broadcastEval: ReturnType<typeof vi.fn> }> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { DmProxyIntegration } =
    await import('../../src/integrations/dm-proxy-integration/index.js')
  const { Api } = await import('../../src/models/api.js')

  const shardManager = { broadcastEval, shards } as unknown as import('discord.js').ShardingManager
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

  it('returns 200 with the API key', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(broadcastEval)

    const allowed = await post(app, { userId: USER_ID, message: 'hello' }, API_KEY)
    expect(allowed.status).toBe(200)

    expect(broadcastEval).toHaveBeenCalledTimes(1)
  })

  it('returns 401 without the API key, and 404 when the key is unset', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(broadcastEval)

    const missing = await post(app, { userId: USER_ID, message: 'hello' }, null)
    expect(missing.status).toBe(401)

    const wrong = await post(app, { userId: USER_ID, message: 'hello' }, 'not-the-key')
    expect(wrong.status).toBe(401)

    const prefixed = await post(app, { userId: USER_ID, message: 'hello' }, `Bearer ${API_KEY}`)
    expect(prefixed.status).toBe(401)

    delete process.env.INTEGRATION_DM_PROXY
    const { app: unconfigured } = await buildApp(broadcastEval)
    const disabled = await post(unconfigured, { userId: USER_ID, message: 'hello' })
    expect(disabled.status).toBe(404)

    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('delivers a DM with the expected message', async () => {
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
    expect(options.context).toEqual({ userId: USER_ID, message: 'Reminder: canvass at noon.' })
  })

  it("delivers a DM and pins the eval to the first ready shard's id", async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(
      broadcastEval,
      new Collection([
        [0, { ready: false, id: 0 }],
        [1, { ready: true, id: 1 }],
      ]),
    )

    const res = await post(app, { userId: USER_ID, message: 'Reminder: canvass at noon.' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const options = broadcastEval.mock.calls[0]![1] as {
      shard: number
      context: { userId: string; message: string }
    }
    expect(options.shard).toBe(1)
  })

  it("delivers a DM and pins the eval to the first ready shard's id when it's zero", async () => {
    // A clustering shardList of [3, 0, ...] puts shard 0 behind an unready shard 3, so
    // firstKey() is 3 while the ready shard's id is 0. Selecting on a falsy-but-valid id
    // has to keep the 0 rather than fall back.
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(
      broadcastEval,
      new Collection([
        [3, { ready: false, id: 3 }],
        [0, { ready: true, id: 0 }],
      ]),
    )

    const res = await post(app, { userId: USER_ID, message: 'Reminder: canvass at noon.' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const options = broadcastEval.mock.calls[0]![1] as {
      shard: number
      context: { userId: string; message: string }
    }
    expect(options.shard).toBe(0)
  })

  it('delivers a DM and pins the eval to the first key when no shard is ready', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(
      broadcastEval,
      new Collection([
        [2, { ready: false, id: 2 }],
        [1, { ready: false, id: 1 }],
      ]),
    )

    const res = await post(app, { userId: USER_ID, message: 'Reminder: canvass at noon.' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const options = broadcastEval.mock.calls[0]![1] as {
      shard: number
      context: { userId: string; message: string }
    }
    expect(options.shard).toBe(2)
  })

  it('passes a callback that survives being stringified for the shard process', async () => {
    // discord.js evaluates `(${script})(this, context)` in the shard process, so
    // the callback has to stringify into a valid expression. A class method does
    // not (`async name() {}` is only legal inside a class body), and a mocked
    // broadcastEval never stringifies anything — so nothing else here would
    // catch that.
    const broadcastEval = vi.fn().mockResolvedValue(DELIVERED)
    const { app } = await buildApp(broadcastEval)

    await post(app, { userId: USER_ID, message: 'hello' })

    const script = broadcastEval.mock.calls[0]![0] as (...args: unknown[]) => unknown
    expect(() => new Function(`return (${script})`)).not.toThrow()
  })

  it('returns 502 when the shard reports a failure with no Discord error code', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'user.send is not a function' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({
      error: true,
      delivered: false,
      reason: 'discord_error',
      message: 'user.send is not a function',
    })
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

  it('returns 200 delivered:false when there is no mutual guild (50278)', async () => {
    const broadcastEval = vi.fn().mockResolvedValue({
      ok: false,
      code: 50278,
      message: 'Cannot send messages to this user due to having no mutual guilds',
    })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    // Terminal, not a transport failure: the caller must not retry a volunteer
    // who has left the server.
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

  it('returns 500 when the manager owns no running shards', async () => {
    // Startup, or every shard respawning: transient, so the caller should
    // retry rather than treat it as a rejected request.
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval, new Collection())

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/no local shard/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('returns 500 when broadcastEval itself rejects (controller catchall)', async () => {
    const broadcastEval = vi.fn().mockRejectedValue(new Error('discord exploded'))
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'discord exploded' })
  })

  it('returns 400 for a malformed body and 413 for an oversized one', async () => {
    // express.json() rejects both before the controller runs. Neither can ever succeed on
    // retry, so they must not reach the caller as a 5xx — the documented retry signal.
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const malformed = await request(app)
      .post('/integrations/send-dm')
      .set('Authorization', API_KEY)
      .set('Content-Type', 'application/json')
      .send(`{"userId": "${USER_ID}", "message": "unterminated`)
    expect(malformed.status).toBe(400)

    const oversized = await request(app)
      .post('/integrations/send-dm')
      .set('Authorization', API_KEY)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ userId: USER_ID, message: 'x'.repeat(200_000) }))
    expect(oversized.status).toBe(413)

    expect(broadcastEval).not.toHaveBeenCalled()
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
