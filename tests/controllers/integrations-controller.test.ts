import { type Express, type Request, type Response } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerWarn = vi.fn()
const loggerError = vi.fn()
vi.mock('../../src/services/index.js', () => ({
  Logger: {
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  },
}))

type FakeIntegration = {
  name: string
  endpoint: string
  run: ReturnType<typeof vi.fn>
}

function makeIntegration(overrides: Partial<FakeIntegration> = {}): FakeIntegration {
  return {
    name: 'Fake Integration',
    endpoint: '/fake-event',
    run: vi.fn(async (_req: Request, res: Response) => {
      res.status(200).json({ error: false })
    }),
    ...overrides,
  }
}

async function buildApp(integrations: FakeIntegration[]): Promise<Express> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { Api } = await import('../../src/models/api.js')
  const shardManager = {} as unknown as import('discord.js').ShardingManager
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controller = new IntegrationsController(integrations as any, shardManager)
  const api = new Api([controller])
  return api.app
}

describe('IntegrationsController', () => {
  beforeEach(() => {
    vi.resetModules()
    loggerWarn.mockClear()
    loggerError.mockClear()
  })

  afterEach(() => {
    delete process.env.INTEGRATION_FAKE_INTEGRATION
    delete process.env.INTEGRATION_ANOTHER_ONE
    vi.restoreAllMocks()
  })

  it('skips registering integrations with no configured API key', async () => {
    const integration = makeIntegration()
    const app = await buildApp([integration])

    const res = await request(app).post('/integrations/fake-event').send({})

    expect(res.status).toBe(404)
    expect(integration.run).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('INTEGRATION_FAKE_INTEGRATION'))
  })

  it('returns 401 when Authorization header is missing or wrong', async () => {
    process.env.INTEGRATION_FAKE_INTEGRATION = 'secret'
    const integration = makeIntegration()
    const app = await buildApp([integration])

    const missing = await request(app).post('/integrations/fake-event').send({})
    expect(missing.status).toBe(401)

    const wrong = await request(app)
      .post('/integrations/fake-event')
      .set('Authorization', 'nope')
      .send({})
    expect(wrong.status).toBe(401)

    expect(integration.run).not.toHaveBeenCalled()
  })

  it('invokes integration.run on authorized request', async () => {
    process.env.INTEGRATION_FAKE_INTEGRATION = 'secret'
    const integration = makeIntegration()
    const app = await buildApp([integration])

    const res = await request(app)
      .post('/integrations/fake-event')
      .set('Authorization', 'secret')
      .send({ hello: 'world' })

    expect(res.status).toBe(200)
    expect(integration.run).toHaveBeenCalledTimes(1)
  })

  it('catches thrown errors from integration.run and responds 500', async () => {
    process.env.INTEGRATION_FAKE_INTEGRATION = 'secret'
    const integration = makeIntegration({
      run: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const app = await buildApp([integration])

    const res = await request(app)
      .post('/integrations/fake-event')
      .set('Authorization', 'secret')
      .send({})

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'boom' })
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('error occurred'),
      expect.any(Error),
    )
  })

  it('derives env var names from integration names with special characters', async () => {
    process.env.INTEGRATION_ANOTHER_ONE = 'key'
    const integration = makeIntegration({
      name: '  another-one!  ',
      endpoint: '/another',
    })
    const app = await buildApp([integration])

    const res = await request(app)
      .post('/integrations/another')
      .set('Authorization', 'key')
      .send({})

    expect(res.status).toBe(200)
    expect(integration.run).toHaveBeenCalledTimes(1)
  })
})
