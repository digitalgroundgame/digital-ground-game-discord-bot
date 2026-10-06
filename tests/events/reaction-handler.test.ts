/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

import { ReactionHandler } from '../../src/events/reaction-handler.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { type Reaction } from '../../src/reactions/index.js'
import { createMockUser } from '../helpers/discord-mocks.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')
const RATE_LIMIT: number = Config.rateLimiting.reactions.amount

const BOT_ID = '987654321098765432'
const AUTHOR_ID = '222333444555666777'

function createHandler(options: { rateLimited?: boolean } = {}): {
  handler: ReactionHandler
  execute: ReturnType<typeof vi.fn>
} {
  const execute = vi.fn().mockResolvedValue(undefined)
  const reaction: Reaction = {
    emoji: '🪙',
    requireGuild: true,
    requireSentByClient: false,
    requireEmbedAuthorTag: false,
    ...options,
    execute,
  }
  const eventDataService: any = {
    create: vi.fn().mockResolvedValue(new EventData(Language.Default, Language.Default)),
  }
  return { handler: new ReactionHandler([reaction], eventDataService), execute }
}

function react(
  handler: ReactionHandler,
  reactorId: string,
  options: { emoji?: string; inGuild?: boolean } = {},
): Promise<void> {
  const client = { user: { id: BOT_ID } }
  const msgReaction: any = { client, emoji: { name: options.emoji ?? '🪙' } }
  const msg: any = {
    client,
    guild: (options.inGuild ?? true) ? { id: '111222333444555666' } : null,
    channel: {},
    author: { id: AUTHOR_ID },
    embeds: [],
  }
  return handler.process(msgReaction, msg, createMockUser({ id: reactorId }))
}

describe('ReactionHandler', () => {
  it('does not rate limit many different members reacting to one popular message', async () => {
    const { handler, execute } = createHandler()
    const reactions = RATE_LIMIT + 5

    for (let i = 0; i < reactions; i++) {
      await react(handler, `reactor-${i}`)
    }

    expect(execute).toHaveBeenCalledTimes(reactions)
  })

  it('rate limits a single member reacting too quickly', async () => {
    const { handler, execute } = createHandler()

    for (let i = 0; i < RATE_LIMIT + 5; i++) {
      await react(handler, 'reactor-1')
    }

    expect(execute).toHaveBeenCalledTimes(RATE_LIMIT)
  })

  it('does not count reactions with an emoji no reaction handles toward the limit', async () => {
    const { handler, execute } = createHandler()

    for (let i = 0; i < RATE_LIMIT + 5; i++) {
      await react(handler, 'reactor-1', { emoji: '👍' })
    }
    await react(handler, 'reactor-1')

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not count reactions filtered out by the reaction’s requirements toward the limit', async () => {
    const { handler, execute } = createHandler()

    for (let i = 0; i < RATE_LIMIT + 5; i++) {
      await react(handler, 'reactor-1', { inGuild: false })
    }
    await react(handler, 'reactor-1')

    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('never rate limits a reaction that opts out', async () => {
    const { handler, execute } = createHandler({ rateLimited: false })
    const reactions = RATE_LIMIT + 5

    for (let i = 0; i < reactions; i++) {
      await react(handler, 'reactor-1')
    }

    expect(execute).toHaveBeenCalledTimes(reactions)
  })
})
