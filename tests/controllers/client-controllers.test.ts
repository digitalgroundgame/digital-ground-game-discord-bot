import { ActivityType, Collection, type Client } from 'discord.js'
import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GuildsController } from '../../src/controllers/guilds-controller.js'
import { PresenceController } from '../../src/controllers/presence-controller.js'
import { type CustomClient } from '../../src/extensions/index.js'
import { Api } from '../../src/models/api.js'

const API_KEY = 'test-api-key'

function buildGuildsApp(): Express {
  const client = {
    guilds: {
      cache: new Collection([
        ['111111111111111111', {}],
        ['222222222222222222', {}],
      ]),
    },
  } as unknown as Client
  return new Api([new GuildsController(client)]).app
}

function buildPresenceApp(setPresence: ReturnType<typeof vi.fn>): Express {
  const client = { setPresence } as unknown as CustomClient
  return new Api([new PresenceController(client)]).app
}

describe('single-client API controllers', () => {
  beforeEach(() => {
    process.env.DISCORD_BOT_API_SECRET = API_KEY
  })

  afterEach(() => {
    delete process.env.DISCORD_BOT_API_SECRET
    vi.restoreAllMocks()
  })

  it('returns guild IDs from the local client cache', async () => {
    const res = await request(buildGuildsApp()).get('/guilds').set('Authorization', API_KEY)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ guilds: ['111111111111111111', '222222222222222222'] })
  })

  it('protects the guild listing with the bot API secret', async () => {
    const res = await request(buildGuildsApp()).get('/guilds')

    expect(res.status).toBe(401)
  })

  it('sets presence directly on the client', async () => {
    const setPresence = vi.fn()
    const res = await request(buildPresenceApp(setPresence))
      .put('/presence')
      .set('Authorization', API_KEY)
      .send({ type: 'Streaming', name: 'community events', url: 'https://example.com/live' })

    expect(res.status).toBe(200)
    expect(setPresence).toHaveBeenCalledWith(
      ActivityType.Streaming,
      'community events',
      'https://example.com/live',
    )
  })

  it('rejects unsupported presence types', async () => {
    const setPresence = vi.fn()
    const res = await request(buildPresenceApp(setPresence))
      .put('/presence')
      .set('Authorization', API_KEY)
      .send({ type: 'Custom', name: 'status', url: 'https://example.com/live' })

    expect(res.status).toBe(400)
    expect(setPresence).not.toHaveBeenCalled()
  })
})
