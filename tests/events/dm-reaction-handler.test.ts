import { type MessageReaction, type User } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DmReactionHandler } from '../../src/events/dm-reaction-handler.js'
import { type CrmService } from '../../src/services/crm-service.js'

const BOT_ID = '923456789012345678'
const USER_ID = '123456789012345678'
const MESSAGE_ID = '423456789012345678'

function reaction(
  overrides: {
    guildId?: string | null
    authorId?: string
    emoji?: { id: string | null; name: string | null }
    fetchFails?: boolean
  } = {},
): MessageReaction {
  const message = {
    id: MESSAGE_ID,
    guildId: overrides.guildId ?? null,
    partial: true,
    fetch: overrides.fetchFails
      ? vi.fn().mockRejectedValue(new Error('gone'))
      : vi.fn().mockResolvedValue({ id: MESSAGE_ID, author: { id: overrides.authorId ?? BOT_ID } }),
  }
  return {
    client: { user: { id: BOT_ID } },
    emoji: overrides.emoji ?? { id: null, name: '👍' },
    message,
  } as unknown as MessageReaction
}

function reactor(id = USER_ID, bot = false): User {
  return { id, bot, partial: false } as unknown as User
}

describe('DmReactionHandler', () => {
  let crmService: CrmService

  beforeEach(() => {
    crmService = { reportReaction: vi.fn(async () => {}) } as unknown as CrmService
  })

  it.each([true, false])('forwards a reaction to a DM the bot sent (added: %s)', async (added) => {
    await new DmReactionHandler(crmService).process(reaction(), reactor(), added)

    expect(crmService.reportReaction).toHaveBeenCalledWith({
      message_id: MESSAGE_ID,
      user_id: USER_ID,
      emoji: '👍',
      added,
    })
  })

  it('names a custom emoji', async () => {
    await new DmReactionHandler(crmService).process(
      reaction({ emoji: { id: '600000000000000001', name: 'party_parrot' } }),
      reactor(),
      true,
    )

    expect(crmService.reportReaction).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: ':party_parrot:' }),
    )
  })

  it('ignores reactions in a server', async () => {
    await new DmReactionHandler(crmService).process(
      reaction({ guildId: '523456789012345678' }),
      reactor(),
      true,
    )

    expect(crmService.reportReaction).not.toHaveBeenCalled()
  })

  it("ignores reactions to the user's own messages", async () => {
    await new DmReactionHandler(crmService).process(
      reaction({ authorId: USER_ID }),
      reactor(),
      true,
    )

    expect(crmService.reportReaction).not.toHaveBeenCalled()
  })

  it('ignores the bot and other bots reacting', async () => {
    const handler = new DmReactionHandler(crmService)

    await handler.process(reaction(), reactor(BOT_ID, true), true)
    await handler.process(reaction(), reactor('823456789012345678', true), true)

    expect(crmService.reportReaction).not.toHaveBeenCalled()
  })

  it('ignores an emoji with no name, such as a deleted custom one', async () => {
    await new DmReactionHandler(crmService).process(
      reaction({ emoji: { id: '600000000000000001', name: null } }),
      reactor(),
      true,
    )

    expect(crmService.reportReaction).not.toHaveBeenCalled()
  })

  it('swallows a failure to read the message', async () => {
    await expect(
      new DmReactionHandler(crmService).process(reaction({ fetchFails: true }), reactor(), true),
    ).resolves.toBeUndefined()

    expect(crmService.reportReaction).not.toHaveBeenCalled()
  })

  it('does nothing when crm is disabled', async () => {
    const message = reaction()

    await new DmReactionHandler().process(message, reactor(), true)

    expect(
      (message.message as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch,
    ).not.toHaveBeenCalled()
  })
})
