import { type ChatInputCommandInteraction, type EmbedBuilder, GuildMember } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn(async () => undefined))
const hasRoleMock = vi.hoisted(() => vi.fn(() => true))
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('../../src/utils/index.js', () => ({
  InteractionUtils: { send: sendMock },
  RoleUtils: { memberHasAnyConfiguredRole: hasRoleMock },
}))
vi.mock('../../src/services/logger.js', () => ({ Logger: loggerMock }))

import { LinkedAccountsCommand } from '../../src/commands/chat/linked-accounts-command.js'
import { CommandDeferType } from '../../src/commands/index.js'
import { ChatCommandMetadata } from '../../src/commands/metadata.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { UserService } from '../../src/services/user-service.js'
import { createMockUser } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const data = new EventData(Language.Default, Language.Default)
const issuer = createMockUser({
  id: 'coordinator-1',
  tag: 'Coordinator#0001',
  toString: () => '<@coordinator-1>',
})
const target = createMockUser({
  id: 'member-1',
  tag: 'Member#0001',
  toString: () => '<@member-1>',
})

/** A slash-command interaction from `issuer`, optionally naming a `user`. */
function createInteraction(user: unknown = null): ChatInputCommandInteraction {
  return {
    user: issuer,
    member: Object.create(GuildMember.prototype),
    options: { getUser: vi.fn(() => user) },
  } as unknown as ChatInputCommandInteraction
}

/** The embed and ephemeral flag of the most recent reply. */
function lastSent(): { embed: EmbedBuilder; description: string; ephemeral: boolean } {
  const calls = sendMock.mock.calls as unknown as [unknown, EmbedBuilder, boolean][]
  const call = calls[calls.length - 1]
  if (!call) throw new Error('no reply was sent')
  return { embed: call[1], description: call[1].data.description ?? '', ephemeral: call[2] }
}

/** Every message passed to Logger.info, joined, to check what was logged. */
function loggedInfo(): string {
  return loggerMock.info.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('LinkedAccountsCommand', () => {
  let users: UserService
  let command: LinkedAccountsCommand

  beforeEach(() => {
    sendMock.mockClear()
    loggerMock.info.mockClear()
    hasRoleMock.mockReset()
    hasRoleMock.mockReturnValue(true)
    users = new UserService(createTestDatabase())
    command = new LinkedAccountsCommand(users)
  })

  it('replies privately', () => {
    expect(command.deferType).toBe(CommandDeferType.HIDDEN)
  })

  it('is hidden from regular members and unavailable in DMs', () => {
    const metadata = ChatCommandMetadata.LINKED_ACCOUNTS
    expect(metadata?.dm_permission).toBe(false)
    expect(metadata?.default_member_permissions).toBeTruthy()
  })

  it('shows a coordinator every account the member linked, Google first', async () => {
    await users.linkAccount(target.id, 'github', { externalId: 'octocat' })
    await users.linkAccount(target.id, 'google', {
      externalId: 'member@example.com',
      email: 'member@example.com',
    })

    await command.execute(createInteraction(target), data)

    const { description, ephemeral } = lastSent()
    expect(ephemeral).toBe(true)
    expect(description).toContain(target.toString())
    const google = description.indexOf('member@example.com')
    const github = description.indexOf('octocat')
    expect(google).toBeGreaterThan(-1)
    expect(github).toBeGreaterThan(google)
    expect(description).toMatch(/<t:\d+:R>/)
  })

  it('logs who looked up whom without logging the email', async () => {
    await users.linkAccount(target.id, 'google', {
      externalId: 'member@example.com',
      email: 'member@example.com',
    })
    loggerMock.info.mockClear()

    await command.execute(createInteraction(target), data)

    expect(loggedInfo()).toContain('Coordinator#0001')
    expect(loggedInfo()).toContain('Member#0001')
    expect(loggedInfo()).not.toContain('member@example.com')
  })

  it('shows a GitHub-only link', async () => {
    await users.linkAccount(target.id, 'github', { externalId: 'octocat' })

    await command.execute(createInteraction(target), data)

    const { description } = lastSent()
    expect(description).toContain('GitHub')
    expect(description).toContain('octocat')
    expect(description).not.toContain('Google')
  })

  it('says when the member has no linked accounts', async () => {
    await command.execute(createInteraction(target), data)

    const { description, ephemeral } = lastSent()
    expect(ephemeral).toBe(true)
    expect(description).toContain(target.toString())
    expect(description).toContain("hasn't linked any accounts")
  })

  it('refuses a member without a coordinator role and shows them nothing', async () => {
    hasRoleMock.mockReturnValue(false)
    await users.linkAccount(target.id, 'google', {
      externalId: 'member@example.com',
      email: 'member@example.com',
    })
    const listSpy = vi.spyOn(users, 'listLinkedAccounts')

    await command.execute(createInteraction(target), data)

    const { description, ephemeral } = lastSent()
    expect(ephemeral).toBe(true)
    expect(description).toContain("don't have permission")
    expect(description).not.toContain('member@example.com')
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('lets any member look up their own links', async () => {
    hasRoleMock.mockReturnValue(false)
    await users.linkAccount(issuer.id, 'google', {
      externalId: 'me@example.com',
      email: 'me@example.com',
    })

    await command.execute(createInteraction(), data)

    expect(lastSent().description).toContain('me@example.com')
    expect(hasRoleMock).not.toHaveBeenCalled()
  })

  it('reports a failed lookup', async () => {
    vi.spyOn(users, 'listLinkedAccounts').mockRejectedValue(new Error('db down'))

    await command.execute(createInteraction(target), data)

    expect(lastSent().description).toContain('Something went wrong')
  })

  it('says account linking is not configured without a database', async () => {
    await new LinkedAccountsCommand().execute(createInteraction(target), data)

    expect(lastSent().description).toContain("isn't configured")
  })
})
