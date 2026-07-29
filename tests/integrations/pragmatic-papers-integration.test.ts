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

async function buildApp(send = vi.fn().mockResolvedValue(undefined)): Promise<{
  app: Express
  send: ReturnType<typeof vi.fn>
}> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { PragmaticPapersIntegration } =
    await import('../../src/integrations/pragmatic-papers-integration.js')
  const { Api } = await import('../../src/models/api.js')

  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    send,
  }
  const client = {
    channels: { cache: { get: vi.fn().mockReturnValue(channel) } },
  } as unknown as Client
  const controller = new IntegrationsController([new PragmaticPapersIntegration()], client)
  const api = new Api([controller])
  return { app: api.app, send }
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

  it('publishes a volume through the single Discord client', async () => {
    const { app, send } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: {
        volumeNumber: 3,
        title: 'Spring Edition',
        articles: [
          { name: 'First Article', slug: 'first', authors: [{ name: 'Alice' }] },
          { name: 'Second Article', slug: 'second', authors: [{ name: 'Bob' }] },
        ],
      },
    })

    expect(res.status).toBe(200)
    expect(send).toHaveBeenCalledTimes(1)
    const message = send.mock.calls[0]![0] as { embeds: Array<{ title: string }> }
    expect(message.embeds[0]!.title).toBe('Volume 3 — Spring Edition')
  })

  it('publishes a standalone article', async () => {
    const { app, send } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: {
        articles: [
          { name: 'Solo Article', slug: 'solo', authors: [{ name: 'Dave' }, { name: 'Eve' }] },
        ],
      },
    })

    expect(res.status).toBe(200)
    const message = send.mock.calls[0]![0] as {
      embeds: Array<{ title: string; description: string; url: string }>
    }
    expect(message.embeds[0]).toMatchObject({
      title: 'Solo Article',
      description: 'by Dave, Eve',
      url: 'https://pragmaticpapers.com/articles/solo',
    })
  })

  it('returns 500 when Discord rejects the channel send', async () => {
    const { app } = await buildApp(vi.fn().mockRejectedValue(new Error('discord exploded')))
    const res = await post(app, {
      event: 'publish',
      payload: { articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }] },
    })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: true, message: 'discord exploded' })
  })

  it.each([
    [{ payload: {} }, /missing 'event' field/i],
    [{ event: 'publish' }, /does not contain a payload/i],
    [{ event: 'delete', payload: {} }, /unhandled event 'delete'/i],
    [
      {
        event: 'publish',
        payload: {
          articles: [
            { name: 'A', slug: 'a', authors: [{ name: 'Alice' }] },
            { name: 'B', slug: 'b', authors: [{ name: 'Bob' }] },
          ],
        },
      },
      /exactly one article/i,
    ],
    [
      {
        event: 'publish',
        payload: {
          volumeNumber: 'three',
          articles: [{ name: 'A', slug: 'a', authors: [{ name: 'Alice' }] }],
        },
      },
      /volumeNumber must be a valid number/i,
    ],
    [{ event: 'publish', payload: { articles: 'nope' } }, /articles must be an array/i],
  ])('rejects invalid webhook payload %#', async (body, expectedMessage) => {
    const { app, send } = await buildApp()
    const res = await post(app, body)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(expectedMessage)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns 500 when an article is missing authors', async () => {
    const { app, send } = await buildApp()
    const res = await post(app, {
      event: 'publish',
      payload: { articles: [{ name: 'Only Name', slug: 'only-name' }] },
    })

    expect(res.status).toBe(500)
    expect(send).not.toHaveBeenCalled()
  })
})
