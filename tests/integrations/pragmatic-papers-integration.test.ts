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

async function buildApp(
  broadcastEval: (...args: unknown[]) => unknown = vi.fn().mockResolvedValue([true]),
): Promise<{ app: Express; broadcastEval: ReturnType<typeof vi.fn> }> {
  const { IntegrationsController } = await import(
    '../../src/controllers/integrations-controller.js'
  )
  const { PragmaticPapersIntegration } = await import(
    '../../src/integrations/pragmatic-papers-integration.js'
  )
  const { Api } = await import('../../src/models/api.js')

  const shardManager = { broadcastEval } as unknown as import('discord.js').ShardingManager
  const integration = new PragmaticPapersIntegration()
  const controller = new IntegrationsController([integration], shardManager)
  const api = new Api([controller])
  return { app: api.app, broadcastEval: broadcastEval as ReturnType<typeof vi.fn> }
}

function post(app: Express, body: object, auth: string | null = API_KEY) {
  const req = request(app).post('/integrations/pp-event').send(body)
  if (auth !== null) req.set('Authorization', auth)
  return req
}

describe('PragmaticPapersIntegration', () => {
  beforeEach(() => {
    process.env.INTEGRATION_PRAGMATIC_PAPERS = API_KEY
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.INTEGRATION_PRAGMATIC_PAPERS
    vi.restoreAllMocks()
  })

  it('publishes a volume successfully', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([true])
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        volumeNumber: 3,
        title: 'Spring Edition',
        articles: [
          { name: 'First Article', slug: 'first', authors: [{ name: 'Alice' }] },
          {
            name: 'Second Article',
            slug: 'second',
            authors: [{ name: 'Bob' }, { name: 'Carol' }],
          },
        ],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(200)
    expect(res.body.error).toBe(false)
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const ctx = broadcastEval.mock.calls[0]![1] as { context: { embed: { title: string } } }
    expect(ctx.context.embed.title).toBe('Volume 3 — Spring Edition')
  })

  it('publishes a standalone article successfully (no volumeNumber)', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([true])
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        articles: [
          { name: 'Solo Article', slug: 'solo', authors: [{ name: 'Dave' }, { name: 'Eve' }] },
        ],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(200)
    expect(res.body.error).toBe(false)
    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const ctx = broadcastEval.mock.calls[0]![1] as {
      context: { embed: { title: string; description: string; url: string } }
    }
    expect(ctx.context.embed.title).toBe('Solo Article')
    expect(ctx.context.embed.description).toBe('by Dave, Eve')
    expect(ctx.context.embed.url).toBe('https://pragmaticpapers.com/articles/solo')
  })

  it('rejects multiple articles when volumeNumber is not provided', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        articles: [
          { name: 'A', slug: 'a', authors: [{ name: 'Alice' }] },
          { name: 'B', slug: 'b', authors: [{ name: 'Bob' }] },
        ],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(true)
    expect(res.body.message).toMatch(/exactly one article/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects articles with missing author field', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        articles: [{ name: 'Only Name', slug: 'only-name' }],
      },
    }

    const res = await post(app, body)

    // validation passes shape checks (name/slug are strings), but handlePublish
    // accesses authors; the controller catch-all should turn this into 500.
    expect(res.status).toBe(500)
    expect(res.body.error).toBe(true)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('rejects articles with missing title field (non-string title)', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        volumeNumber: 5,
        title: 123,
        articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(true)
    expect(res.body.message).toMatch(/title must be a valid string/i)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('omits title when only volumeNumber is provided', async () => {
    const broadcastEval = vi.fn().mockResolvedValue([true])
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        volumeNumber: 7,
        articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(200)
    const ctx = broadcastEval.mock.calls[0]![1] as { context: { embed: { title: string } } }
    expect(ctx.context.embed.title).toBe('Volume 7')
  })

  it('returns 500 when discord broadcastEval throws (controller catchall)', async () => {
    const broadcastEval = vi.fn().mockRejectedValue(new Error('discord exploded'))
    const { app } = await buildApp(broadcastEval)

    const body = {
      event: 'publish',
      payload: {
        articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }],
      },
    }

    const res = await post(app, body)

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'discord exploded' })
  })

  it('rejects missing event field', async () => {
    const { app } = await buildApp()
    const res = await post(app, { payload: {} })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/missing 'event' field/i)
  })

  it('rejects missing publish payload', async () => {
    const { app } = await buildApp()
    const res = await post(app, { event: 'publish' })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/does not contain a payload/i)
  })

  it('rejects unknown event types', async () => {
    const { app } = await buildApp()
    const res = await post(app, { event: 'delete', payload: {} })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/unhandled event 'delete'/i)
  })

  it('rejects non-numeric volumeNumber', async () => {
    const { app } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: {
        volumeNumber: 'three',
        articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/volumeNumber must be a valid number/i)
  })

  it('rejects when articles is not an array', async () => {
    const { app } = await buildApp()
    const res = await post(app, { event: 'publish', payload: { articles: 'nope' } })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/articles must be an array/i)
  })

  it('rejects articles[i] with non-string name', async () => {
    const { app } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: {
        volumeNumber: 1,
        articles: [
          { name: 'ok', slug: 'ok', authors: [{ name: 'A' }] },
          { name: 42, slug: 'bad', authors: [{ name: 'B' }] },
        ],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/articles\[1\]\.name/)
  })

  it('rejects articles[i] with non-string slug', async () => {
    const { app } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: {
        articles: [{ name: 'ok', slug: 99, authors: [{ name: 'A' }] }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/articles\[0\]\.slug/)
  })

  it('rejects non-object articles[i]', async () => {
    const { app } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: { articles: ['nope'] },
    })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/articles\[0\] must be an object/)
  })
})
