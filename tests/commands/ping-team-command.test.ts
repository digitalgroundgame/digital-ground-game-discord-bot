import {
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  GuildMember,
} from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatCommandMetadata } from '../../src/commands/index.js'
import { DiscordLimits, type GitHubTeam } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { type GitHubTeamsService, type UserService } from '../../src/services/index.js'

const sendMock = vi.hoisted(() => vi.fn(async () => undefined))
const editReplyMock = vi.hoisted(() => vi.fn(async () => undefined))
const hasRoleMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('../../src/utils/index.js', () => ({
  InteractionUtils: { send: sendMock, editReply: editReplyMock },
  RoleUtils: { memberHasAnyConfiguredRole: hasRoleMock },
}))

import { PingTeamCommand } from '../../src/commands/chat/ping-team-command.js'

const TEAMS: GitHubTeam[] = [
  { name: 'Discord Bot', slug: 'discord-bot' },
  { name: 'Blue Book', slug: 'blue-book' },
]

const data = new EventData(Language.Default, Language.Default)
const requester = { id: 'requester', tag: 'Director#0001', toString: () => '<@requester>' }

function createInteraction(team: string): ChatInputCommandInteraction {
  return {
    user: requester,
    inGuild: () => true,
    guild: { id: 'guild-1' },
    options: { getString: vi.fn(() => team) },
  } as unknown as ChatInputCommandInteraction
}

function createAutocompleteInteraction(): AutocompleteInteraction {
  return { member: Object.create(GuildMember.prototype), options: {} } as AutocompleteInteraction
}

function focusedTeam(value: string): AutocompleteFocusedOption {
  return { name: 'team', value } as AutocompleteFocusedOption
}

function githubService(
  logins: string[] | { status: 'error'; message: string },
  teams: GitHubTeam[] = TEAMS,
): GitHubTeamsService {
  return {
    isConfigured: () => true,
    getTeams: vi.fn(() => teams),
    warmTeams: vi.fn(),
    refreshTeams: vi.fn(async () => true),
    listTeamMembers: vi.fn(async () =>
      Array.isArray(logins)
        ? { status: 'ok', logins }
        : { status: 'error', message: logins.message },
    ),
  } as unknown as GitHubTeamsService
}

function userService(userIds: string[] | Error): UserService {
  return {
    findDiscordUserIdsByGithubLogins: vi.fn(async () => {
      if (userIds instanceof Error) throw userIds
      return userIds
    }),
  } as unknown as UserService
}

/** The description of the embed most recently sent as a reply. */
function lastReply(): string {
  const calls = editReplyMock.mock.calls as unknown as [unknown, EmbedBuilder][]
  const call = calls[calls.length - 1]
  if (!call) throw new Error('no reply was edited')
  return call[1].data.description ?? ''
}

/** Every message sent after the header, with its content and allowed mentions. */
function sentMentions(): { content: string; allowedMentions: { users: string[] } }[] {
  return sendMock.mock.calls.map((call) => call[1])
}

describe('PingTeamCommand', () => {
  beforeEach(() => {
    sendMock.mockClear()
    editReplyMock.mockClear()
    hasRoleMock.mockReset()
    hasRoleMock.mockReturnValue(true)
  })

  describe('autocomplete', () => {
    const command = new PingTeamCommand(githubService([]))

    it('suggests the cached teams sorted by name', async () => {
      const choices = await command.autocomplete(createAutocompleteInteraction(), focusedTeam(''))

      expect(choices.map((choice) => choice.value)).toEqual(['Blue Book', 'Discord Bot'])
    })

    it('narrows the suggestions to what was typed', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction(),
        focusedTeam('blue'),
      )

      expect(choices.map((choice) => choice.value)).toEqual(['Blue Book'])
    })

    it('suggests nothing to a member without an allowed role', async () => {
      hasRoleMock.mockReturnValue(false)

      const choices = await command.autocomplete(createAutocompleteInteraction(), focusedTeam(''))

      expect(choices).toEqual([])
    })

    it('suggests nothing outside a server', async () => {
      const intr = { member: null, options: {} } as unknown as AutocompleteInteraction

      expect(await command.autocomplete(intr, focusedTeam(''))).toEqual([])
      expect(hasRoleMock).not.toHaveBeenCalled()
    })

    it('caps the suggestions at the Discord limit', async () => {
      const many = Array.from({ length: 40 }, (_, index) => ({
        name: `Team ${index}`,
        slug: `t-${index}`,
      }))
      const choices = await new PingTeamCommand(githubService([], many)).autocomplete(
        createAutocompleteInteraction(),
        focusedTeam(''),
      )

      expect(choices).toHaveLength(DiscordLimits.CHOICES_PER_AUTOCOMPLETE)
    })
  })

  describe('execute', () => {
    it('refuses outside a server', async () => {
      const intr = {
        user: requester,
        inGuild: () => false,
        guild: null,
        options: { getString: vi.fn(() => 'Blue Book') },
      } as unknown as ChatInputCommandInteraction
      const service = githubService(['octocat'])
      const command = new PingTeamCommand(service, userService(['1']))

      await command.execute(intr, data)

      expect(editReplyMock).toHaveBeenCalledOnce()
      expect(service.listTeamMembers).not.toHaveBeenCalled()
      expect(sendMock).not.toHaveBeenCalled()
    })
    it('pings the linked members under a header naming the team', async () => {
      const command = new PingTeamCommand(
        githubService(['OctoCat', 'hubot']),
        userService(['1', '2']),
      )

      await command.execute(createInteraction('Discord Bot'), data)

      const header = editReplyMock.mock.calls[0] as unknown as [unknown, { content: string }]
      expect(header[1].content).toBe('📣 Paging **Discord Bot** (requested by <@requester>)')
      expect(sentMentions()).toEqual([
        { content: '<@1> <@2>', allowedMentions: { users: ['1', '2'] } },
      ])
    })

    it('matches logins case-insensitively', async () => {
      const service = userService(['1'])
      const command = new PingTeamCommand(githubService(['OctoCat']), service)

      await command.execute(createInteraction('discord-bot'), data)

      expect(service.findDiscordUserIdsByGithubLogins).toHaveBeenCalledWith(['octocat'])
    })

    it('does not ping the requester', async () => {
      const command = new PingTeamCommand(
        githubService(['octocat']),
        userService(['1', 'requester']),
      )

      await command.execute(createInteraction('Blue Book'), data)

      expect(sentMentions()).toEqual([{ content: '<@1>', allowedMentions: { users: ['1'] } }])
    })

    it('refreshes the team list once when the team is not cached', async () => {
      const service = githubService(['octocat'])
      const created: GitHubTeam = { name: 'New Team', slug: 'new-team' }
      let current = [...TEAMS]
      vi.mocked(service.getTeams).mockImplementation(() => current)
      vi.mocked(service.refreshTeams).mockImplementation(async () => {
        current = [...TEAMS, created]
        return true
      })
      const command = new PingTeamCommand(service, userService(['1']))

      await command.execute(createInteraction('New Team'), data)

      expect(service.listTeamMembers).toHaveBeenCalledWith('new-team')
      expect(sentMentions()).toHaveLength(1)
    })

    it('reports an unknown team', async () => {
      const command = new PingTeamCommand(githubService([]), userService(['1']))

      await command.execute(createInteraction('Nope'), data)

      expect(lastReply()).toContain('Unknown team `Nope`')
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('reports an unconfigured bot', async () => {
      const command = new PingTeamCommand(undefined, undefined)

      await command.execute(createInteraction('Blue Book'), data)

      expect(lastReply()).toContain("isn't configured")
    })

    it('reports a failed GitHub request', async () => {
      const command = new PingTeamCommand(
        githubService({ status: 'error', message: '500 boom' }),
        userService(['1']),
      )

      await command.execute(createInteraction('Blue Book'), data)

      expect(lastReply()).toContain("Couldn't read the members of **Blue Book**")
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('reports a failed database lookup', async () => {
      const command = new PingTeamCommand(
        githubService(['octocat']),
        userService(new Error('db down')),
      )

      await command.execute(createInteraction('Blue Book'), data)

      expect(lastReply()).toContain("Couldn't read the members of **Blue Book**")
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('reports when nobody on the team linked a GitHub account', async () => {
      const command = new PingTeamCommand(githubService(['octocat']), userService([]))

      await command.execute(createInteraction('Blue Book'), data)

      expect(lastReply()).toContain(
        'No other members of **Blue Book** have linked a GitHub account',
      )
      expect(sendMock).not.toHaveBeenCalled()
    })

    it('pings nobody when the requester is the only linked member', async () => {
      const command = new PingTeamCommand(githubService(['octocat']), userService(['requester']))

      await command.execute(createInteraction('Blue Book'), data)

      expect(lastReply()).toContain(
        'No other members of **Blue Book** have linked a GitHub account',
      )
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('metadata', () => {
    it('registers the command with a required, autocompleted team option', () => {
      const options = ChatCommandMetadata.PING_TEAM.options ?? []

      expect(ChatCommandMetadata.PING_TEAM.name).toBe('ping-team')
      expect(options).toHaveLength(1)
      expect(options[0]).toMatchObject({ name: 'team', autocomplete: true, required: true })
    })
  })
})
