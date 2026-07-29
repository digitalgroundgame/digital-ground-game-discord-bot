import { type Client } from 'discord.js'
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
const CONSTANTS_MODULE = '../../src/integrations/dm-proxy-integration/constants.js'

async function buildApp(options?: {
  fetchUser?: ReturnType<typeof vi.fn>
  send?: ReturnType<typeof vi.fn>
}): Promise<{
  app: Express
  fetchUser: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { DmProxyIntegration } =
    await import('../../src/integrations/dm-proxy-integration/index.js')
  const { Api } = await import('../../src/models/api.js')

  const send = options?.send ?? vi.fn().mockResolvedValue(undefined)
  const fetchUser = options?.fetchUser ?? vi.fn().mockResolvedValue({ send })
  const client = { users: { fetch: fetchUser } } as unknown as Client
  const controller = new IntegrationsController([new DmProxyIntegration()], client)
  const api = new Api([controller])
  return { app: api.app, fetchUser, send }
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
    vi.doUnmock(CONSTANTS_MODULE)
    vi.restoreAllMocks()
  })

  it('requires the configured API key and disables the route when it is unset', async () => {
    const { app, fetchUser } = await buildApp()

    expect((await post(app, { userId: USER_ID, message: 'hello' }, null)).status).toBe(401)
    expect((await post(app, { userId: USER_ID, message: 'hello' }, 'wrong')).status).toBe(401)
    expect(
      (await post(app, { userId: USER_ID, message: 'hello' }, `Bearer ${API_KEY}`)).status,
    ).toBe(401)

    delete process.env.INTEGRATION_DM_PROXY
    const { app: unconfigured } = await buildApp()
    expect((await post(unconfigured, { userId: USER_ID, message: 'hello' })).status).toBe(404)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('fetches the user and delivers the expected message', async () => {
    const { app, fetchUser, send } = await buildApp()

    const res = await post(app, { userId: USER_ID, message: 'Reminder: canvass at noon.' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: true })
    expect(fetchUser).toHaveBeenCalledWith(USER_ID)
    expect(send).toHaveBeenCalledWith('Reminder: canvass at noon.')
  })

  it.each([
    [50007, 'Cannot send messages to this user'],
    [50278, 'Cannot send messages to this user due to having no mutual guilds'],
  ])('returns delivered:false for terminal DM failure %i', async (code, message) => {
    const send = vi.fn().mockRejectedValue({ code, message })
    const { app } = await buildApp({ send })

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, delivered: false, reason: 'dms_closed' })
  })

  it('returns 404 for an unknown user', async () => {
    const fetchUser = vi.fn().mockRejectedValue({ code: 10013, message: 'Unknown User' })
    const { app } = await buildApp({ fetchUser })

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: true, delivered: false, reason: 'unknown_user' })
  })

  it('returns 502 with details for other Discord failures', async () => {
    const send = vi.fn().mockRejectedValue({ code: 40003, message: 'rate limited' })
    const { app } = await buildApp({ send })

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

  it('returns 502 when a Discord failure has no numeric error code', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('user.send failed'))
    const { app } = await buildApp({ send })

    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({
      error: true,
      delivered: false,
      reason: 'discord_error',
      message: 'user.send failed',
    })
  })

  it('returns 500 when Discord does not answer before the timeout', async () => {
    const actual =
      await vi.importActual<
        typeof import('../../src/integrations/dm-proxy-integration/constants.js')
      >(CONSTANTS_MODULE)
    vi.doMock(CONSTANTS_MODULE, () => ({ ...actual, SEND_TIMEOUT_MS: 20 }))

    const fetchUser = vi.fn().mockReturnValue(new Promise(() => {}))
    const { app } = await buildApp({ fetchUser })
    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'Discord did not answer within 20ms.' })
  })

  it('clears the timeout once Discord answers', async () => {
    const actual =
      await vi.importActual<
        typeof import('../../src/integrations/dm-proxy-integration/constants.js')
      >(CONSTANTS_MODULE)
    vi.doMock(CONSTANTS_MODULE, () => ({ ...actual, SEND_TIMEOUT_MS: 20 }))

    const { app } = await buildApp()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const res = await post(app, { userId: USER_ID, message: 'hello' })

    expect(res.status).toBe(200)
    const armed = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 20)
    expect(armed).toBeGreaterThanOrEqual(0)
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[armed]!.value)
  })

  it('returns 400 for malformed JSON', async () => {
    const { app, fetchUser } = await buildApp()

    const res = await request(app)
      .post('/integrations/send-dm')
      .set('Authorization', API_KEY)
      .set('Content-Type', 'application/json')
      .send(`{"userId": "${USER_ID}", "message": "unterminated`)

    expect(res.status).toBe(400)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it('returns 413 for an oversized body', async () => {
    const { app, fetchUser } = await buildApp()

    const res = await request(app)
      .post('/integrations/send-dm')
      .set('Authorization', API_KEY)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ userId: USER_ID, message: 'x'.repeat(200_000) }))

    expect(res.status).toBe(413)
    expect(fetchUser).not.toHaveBeenCalled()
  })

  it.each([
    [{ message: 'hello' }, /userId must be a string/i],
    [{ userId: 123456, message: 'hello' }, /userId must be a string/i],
    [{ userId: 'abc', message: 'hello' }, /snowflake/i],
    [{ userId: USER_ID }, /message must be a string/i],
    [{ userId: USER_ID, message: '' }, /must not be empty/i],
    [{ userId: USER_ID, message: 'x'.repeat(2001) }, /at most 2000 characters/i],
  ])('rejects invalid payload %#', async (body, expectedMessage) => {
    const { app, fetchUser } = await buildApp()
    const res = await post(app, body)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(expectedMessage)
    expect(fetchUser).not.toHaveBeenCalled()
  })
})
