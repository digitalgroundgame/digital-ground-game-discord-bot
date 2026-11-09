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

const API_KEY = 'test-history-key'
const USER_ID = '123456789012345678'
const BOT_ID = '923456789012345678'
const CHANNEL_ID = '323456789012345678'

function historyMessage(id: string, authorId: string) {
  return {
    id,
    authorId,
    content: `message ${id}`,
    createdAt: '2026-10-29T12:00:00.000Z',
    editedAt: null,
    referencedMessageId: null,
    attachments: [],
    reactions: [],
  }
}

// Discord pages newest first.
const OLDER = historyMessage('400000000000000001', BOT_ID)
const NEWER = historyMessage('400000000000000002', USER_ID)
const FETCHED = { ok: true, channelId: CHANNEL_ID, messages: [NEWER, OLDER] }

async function buildApp(
  broadcastEval: (...args: unknown[]) => unknown = vi.fn().mockResolvedValue(FETCHED),
  shards: Collection<number, { ready: boolean; id: number }> = new Collection([
    [0, { ready: true, id: 0 }],
  ]),
): Promise<{ app: Express; broadcastEval: ReturnType<typeof vi.fn> }> {
  const { IntegrationsController } =
    await import('../../src/controllers/integrations-controller.js')
  const { DmHistoryIntegration } =
    await import('../../src/integrations/dm-proxy-integration/history.js')
  const { Api } = await import('../../src/models/api.js')

  const shardManager = { broadcastEval, shards } as unknown as import('discord.js').ShardingManager
  const integration = new DmHistoryIntegration()
  const controller = new IntegrationsController([integration], shardManager)
  const api = new Api([controller])
  return { app: api.app, broadcastEval: broadcastEval as ReturnType<typeof vi.fn> }
}

function post(app: Express, body: object, auth: string | null = API_KEY) {
  const req = request(app).post('/integrations/dm-history').send(body)
  if (auth !== null) req.set('Authorization', auth)
  return req
}

function evalContext(broadcastEval: ReturnType<typeof vi.fn>) {
  return (broadcastEval.mock.calls[0]![1] as { shard: number; context: object }).context
}

describe('DmHistoryIntegration', () => {
  beforeEach(() => {
    process.env.INTEGRATION_DM_HISTORY = API_KEY
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.INTEGRATION_DM_HISTORY
    vi.restoreAllMocks()
  })

  it('returns 401 without its own API key, and 404 when the key is unset', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(FETCHED)
    const { app } = await buildApp(broadcastEval)

    expect((await post(app, { userId: USER_ID }, null)).status).toBe(401)
    expect((await post(app, { userId: USER_ID }, 'not-the-key')).status).toBe(401)

    delete process.env.INTEGRATION_DM_HISTORY
    const { app: unconfigured } = await buildApp(broadcastEval)
    expect((await post(unconfigured, { userId: USER_ID })).status).toBe(404)

    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it('returns the DM channel and its messages oldest first', async () => {
    const { app } = await buildApp()

    const res = await post(app, { userId: USER_ID })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ error: false, channelId: CHANNEL_ID, messages: [OLDER, NEWER] })
  })

  it('fetches 50 messages by default from a single shard', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(FETCHED)
    const { app } = await buildApp(
      broadcastEval,
      new Collection([
        [0, { ready: false, id: 0 }],
        [1, { ready: true, id: 1 }],
      ]),
    )

    await post(app, { userId: USER_ID })

    expect(broadcastEval).toHaveBeenCalledTimes(1)
    const options = broadcastEval.mock.calls[0]![1] as { shard: number; context: object }
    expect(options.shard).toBe(1)
    expect(options.context).toEqual({ userId: USER_ID, limit: 50 })
  })

  it('passes the limit and a before or after cursor through', async () => {
    for (const cursor of ['before', 'after']) {
      const broadcastEval = vi.fn().mockResolvedValue(FETCHED)
      const { app } = await buildApp(broadcastEval)

      const res = await post(app, { userId: USER_ID, limit: 100, [cursor]: OLDER.id })

      expect(res.status).toBe(200)
      expect(evalContext(broadcastEval)).toEqual({
        userId: USER_ID,
        limit: 100,
        [cursor]: OLDER.id,
      })
    }
  })

  it('reads the conversation from the bot client on the shard', async () => {
    const broadcastEval = vi.fn().mockResolvedValue(FETCHED)
    const { app } = await buildApp(broadcastEval)
    await post(app, { userId: USER_ID })

    const script = broadcastEval.mock.calls[0]![0] as (
      client: unknown,
      ctx: object,
    ) => Promise<unknown>
    const fetchMessages = vi.fn().mockResolvedValue(
      new Collection([
        [
          NEWER.id,
          {
            id: NEWER.id,
            author: { id: USER_ID },
            content: 'Sure, I can help',
            createdAt: new Date('2026-10-29T12:05:00Z'),
            editedAt: new Date('2026-10-29T12:06:00Z'),
            reference: { messageId: OLDER.id },
            attachments: new Collection([
              [
                '500000000000000001',
                {
                  id: '500000000000000001',
                  name: 'flyer.png',
                  url: 'https://cdn.discordapp.com/flyer.png',
                  contentType: 'image/png',
                },
              ],
            ]),
            reactions: { cache: new Collection() },
          },
        ],
        [
          OLDER.id,
          {
            id: OLDER.id,
            author: { id: BOT_ID },
            content: 'Can you help on Saturday?',
            createdAt: new Date('2026-10-29T12:00:00Z'),
            editedAt: null,
            reference: null,
            attachments: new Collection(),
            reactions: {
              cache: new Collection([
                ['👍', { emoji: { id: null, name: '👍' }, count: 1, me: false }],
                [
                  '600000000000000001',
                  { emoji: { id: '600000000000000001', name: 'party_parrot' }, count: 2, me: true },
                ],
              ]),
            },
          },
        ],
      ]),
    )
    const createDM = vi
      .fn()
      .mockResolvedValue({ id: CHANNEL_ID, messages: { fetch: fetchMessages } })
    const client = {
      users: { fetch: vi.fn().mockResolvedValue({ createDM }) },
    }

    const result = await script(client, {
      userId: USER_ID,
      limit: 50,
      before: '400000000000000009',
    })

    expect(client.users.fetch).toHaveBeenCalledWith(USER_ID)
    expect(fetchMessages).toHaveBeenCalledWith({
      limit: 50,
      before: '400000000000000009',
      after: undefined,
    })
    expect(result).toEqual({
      ok: true,
      channelId: CHANNEL_ID,
      messages: [
        {
          id: NEWER.id,
          authorId: USER_ID,
          content: 'Sure, I can help',
          createdAt: '2026-10-29T12:05:00.000Z',
          editedAt: '2026-10-29T12:06:00.000Z',
          referencedMessageId: OLDER.id,
          attachments: [
            {
              id: '500000000000000001',
              name: 'flyer.png',
              url: 'https://cdn.discordapp.com/flyer.png',
              contentType: 'image/png',
            },
          ],
          reactions: [],
        },
        {
          id: OLDER.id,
          authorId: BOT_ID,
          content: 'Can you help on Saturday?',
          createdAt: '2026-10-29T12:00:00.000Z',
          editedAt: null,
          referencedMessageId: null,
          attachments: [],
          // Custom emoji by name: the CRM shows them as text.
          reactions: [
            { emoji: '👍', count: 1, me: false },
            { emoji: ':party_parrot:', count: 2, me: true },
          ],
        },
      ],
    })
    // Stringified into the shard process, so it must parse as a standalone expression.
    expect(() => new Function(`return (${script})`)).not.toThrow()
  })

  it('returns 404 for an unknown user (10013)', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 10013, message: 'Unknown User' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID })

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: true, reason: 'unknown_user' })
  })

  it('returns 502 with the code for other Discord errors', async () => {
    const broadcastEval = vi
      .fn()
      .mockResolvedValue({ ok: false, code: 50001, message: 'Missing Access' })
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, { userId: USER_ID })

    expect(res.status).toBe(502)
    expect(res.body).toEqual({
      error: true,
      reason: 'discord_error',
      code: 50001,
      message: 'Missing Access',
    })
  })

  it('returns 500 when no shard is running', async () => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval, new Collection())

    const res = await post(app, { userId: USER_ID })

    expect(res.status).toBe(500)
    expect(broadcastEval).not.toHaveBeenCalled()
  })

  it.each([
    [{}, /userId must be a string/i],
    [{ userId: 123456 }, /userId must be a string/i],
    [{ userId: 'abc' }, /snowflake/i],
    [{ userId: USER_ID, limit: 0 }, /limit must be an integer from 1 to 100/i],
    [{ userId: USER_ID, limit: 101 }, /limit must be an integer from 1 to 100/i],
    [{ userId: USER_ID, limit: 2.5 }, /limit must be an integer/i],
    [{ userId: USER_ID, limit: '50' }, /limit must be an integer/i],
    [{ userId: USER_ID, before: 123 }, /before must be a Discord message ID/i],
    [{ userId: USER_ID, after: 'abc' }, /after must be a Discord message ID/i],
    [{ userId: USER_ID, before: OLDER.id, after: OLDER.id }, /not both/i],
  ])('rejects %j', async (body, message) => {
    const broadcastEval = vi.fn()
    const { app } = await buildApp(broadcastEval)

    const res = await post(app, body)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(message)
    expect(broadcastEval).not.toHaveBeenCalled()
  })
})
