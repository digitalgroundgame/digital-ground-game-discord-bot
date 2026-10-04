/* eslint-disable @typescript-eslint/no-explicit-any */
import { Collection } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerRoles } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { KudosReaction } from '../../src/reactions/kudos-reaction.js'
import { KudosNotifier } from '../../src/services/kudos-notifier.js'
import { KudosService } from '../../src/services/kudos-service.js'
import { Logger } from '../../src/services/logger.js'
import { createMockGuildMember, createMockUser } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const CHANNEL_ID = '555666777888999000'
const GIVER_ID = '333444555666777888'
const AUTHOR_ID = '222333444555666777'
const data = new EventData(Language.Default, Language.Default)

interface ContextOptions {
  reactorId?: string
  authorId?: string
  messageId?: string
  authorBot?: boolean
  webhookId?: string | null
  system?: boolean
  reactorRoleIds?: string[]
  memberFetchFails?: boolean
  removeFails?: boolean
}

function createContext(options: ContextOptions = {}): {
  msgReaction: any
  msg: any
  reactor: any
  author: any
  guild: any
} {
  const reactorId = options.reactorId ?? GIVER_ID
  const authorId = options.authorId ?? AUTHOR_ID

  const reactor = createMockUser({ id: reactorId, tag: `reactor-${reactorId}` })
  const author = createMockUser({
    id: authorId,
    tag: `author-${authorId}`,
    bot: options.authorBot ?? false,
    send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
    createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
    toString: vi.fn().mockReturnValue(`<@${authorId}>`),
  })

  const guild: any = {
    id: GUILD_ID,
    name: 'Test Guild',
    roles: { cache: new Collection() },
    members: { fetch: vi.fn() },
  }
  const member = createMockGuildMember({ id: reactorId, user: reactor, guild })
  for (const roleId of options.reactorRoleIds ?? []) {
    member.roles.cache.set(roleId, { id: roleId })
  }
  guild.members.fetch = options.memberFetchFails
    ? vi.fn().mockRejectedValue(new Error('Unknown Member'))
    : vi.fn().mockResolvedValue(member)

  const msgReaction = {
    emoji: { name: '🪙' },
    users: {
      remove: options.removeFails
        ? vi.fn().mockRejectedValue(new Error('Missing Permissions'))
        : vi.fn().mockResolvedValue(undefined),
    },
  }

  const msg = {
    id: options.messageId ?? '666777888999000111',
    channelId: CHANNEL_ID,
    guild,
    author,
    webhookId: options.webhookId ?? null,
    system: options.system ?? false,
  }

  return { msgReaction, msg, reactor, author, guild }
}

describe('KudosReaction', () => {
  let service: KudosService
  let notifier: KudosNotifier
  let reaction: KudosReaction

  beforeEach(() => {
    service = new KudosService(createTestDatabase())
    notifier = new KudosNotifier(service)
    reaction = new KudosReaction(service, notifier, { allowedRoleIds: [] })
  })

  it('listens for the coin emoji in guilds only, without the generic rate limit', () => {
    expect(reaction.emoji).toBe('🪙')
    expect(reaction.requireGuild).toBe(true)
    expect(reaction.requireSentByClient).toBe(false)
    expect(reaction.requireEmbedAuthorTag).toBe(false)
    // The per-pair cooldown is the real limit; the generic one would leave
    // coins on messages without recording kudos.
    expect(reaction.rateLimited).toBe(false)
  })

  it('gives the message author kudos, keeps the reaction, and DMs a link to the message', async () => {
    const { msgReaction, msg, reactor, author } = createContext()

    await reaction.execute(msgReaction, msg, reactor, data)

    expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
    expect(msgReaction.users.remove).not.toHaveBeenCalled()
    expect(author.send).toHaveBeenCalledOnce()
    const dm = author.send.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(dm).toContain(`<@${GIVER_ID}>`)
    expect(dm).toContain(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${msg.id}`)
  })

  it('removes the reaction without recording kudos while the giver is on cooldown', async () => {
    const first = createContext({ messageId: 'message-1' })
    await reaction.execute(first.msgReaction, first.msg, first.reactor, data)

    const second = createContext({ messageId: 'message-2' })
    await reaction.execute(second.msgReaction, second.msg, second.reactor, data)

    expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
    expect(second.msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
    expect(second.author.send).not.toHaveBeenCalled()
  })

  it('removes the reaction when the giver already used /kudos give on the author this week', async () => {
    await service.giveKudos(GUILD_ID, GIVER_ID, AUTHOR_ID, 'from the command')
    const { msgReaction, msg, reactor } = createContext()

    await reaction.execute(msgReaction, msg, reactor, data)

    expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
    expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
  })

  it('keeps a re-added reaction on the same message without recording another kudos', async () => {
    const first = createContext()
    await reaction.execute(first.msgReaction, first.msg, first.reactor, data)

    const again = createContext()
    await reaction.execute(again.msgReaction, again.msg, again.reactor, data)

    expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
    expect(again.msgReaction.users.remove).not.toHaveBeenCalled()
    expect(again.author.send).not.toHaveBeenCalled()
  })

  it('removes a reaction on the reactor’s own message', async () => {
    const { msgReaction, msg, reactor } = createContext({ authorId: GIVER_ID })

    await reaction.execute(msgReaction, msg, reactor, data)

    expect(await service.getTotal(GUILD_ID, GIVER_ID)).toBe(0)
    expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
  })

  it.each([
    ['a bot', { authorBot: true }],
    ['a webhook', { webhookId: '777888999000111222' }],
    ['a system message', { system: true }],
  ])('removes the reaction on %s without recording kudos', async (_label, options) => {
    const giveSpy = vi.spyOn(service, 'giveKudos')
    const { msgReaction, msg, reactor } = createContext(options)

    await reaction.execute(msgReaction, msg, reactor, data)

    expect(giveSpy).not.toHaveBeenCalled()
    expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
  })

  it('lets any member give kudos without looking them up when no roles are configured', async () => {
    const { msgReaction, msg, reactor, guild } = createContext()

    await reaction.execute(msgReaction, msg, reactor, data)

    expect(guild.members.fetch).not.toHaveBeenCalled()
    expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
  })

  describe('with giver roles configured', () => {
    beforeEach(() => {
      reaction = new KudosReaction(service, notifier, { allowedRoleIds: [ServerRoles.ADMIN.id] })
    })

    it('gives kudos when the reactor has an allowed role', async () => {
      const { msgReaction, msg, reactor } = createContext({
        reactorRoleIds: [ServerRoles.ADMIN.id],
      })

      await reaction.execute(msgReaction, msg, reactor, data)

      expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(1)
      expect(msgReaction.users.remove).not.toHaveBeenCalled()
    })

    it('removes the reaction when the reactor lacks an allowed role', async () => {
      const { msgReaction, msg, reactor } = createContext()

      await reaction.execute(msgReaction, msg, reactor, data)

      expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(0)
      expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
    })

    it('removes the reaction when the reactor cannot be fetched as a member', async () => {
      const { msgReaction, msg, reactor } = createContext({ memberFetchFails: true })

      await reaction.execute(msgReaction, msg, reactor, data)

      expect(await service.getTotal(GUILD_ID, AUTHOR_ID)).toBe(0)
      expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
    })
  })

  it('logs a warning instead of throwing when the reaction cannot be removed', async () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {})
    const { msgReaction, msg, reactor } = createContext({ authorId: GIVER_ID, removeFails: true })

    await expect(reaction.execute(msgReaction, msg, reactor, data)).resolves.toBeUndefined()

    expect(msgReaction.users.remove).toHaveBeenCalledWith(GIVER_ID)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
