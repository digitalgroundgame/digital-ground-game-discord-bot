import {
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiscordLimits, type GitHubTeam, GoogleGroups } from '../../src/constants/index.js'
import { type LinkedAccount } from '../../src/database/schema.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import {
  type GitHubTeamsService,
  type GoogleGroupsService,
  type UserService,
} from '../../src/services/index.js'
import { createMockUser } from '../helpers/discord-mocks.js'

const sendMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../../src/utils/index.js', () => ({
  InteractionUtils: { send: sendMock },
}))

import { GrantAccessCommand } from '../../src/commands/chat/grant-access-command.js'

/** Fails loudly rather than passing vacuously if the config is emptied. */
function firstEntry<T>(record: Record<string, T>, label: string): [string, T] {
  const entry = Object.entries(record)[0]
  if (!entry) throw new Error(`no ${label} configured in config.json`)
  return entry
}

// Google teams still come from config; GitHub teams are discovered at runtime,
// so they are stubbed here the way the service would have cached them.
const GITHUB_TEAMS: GitHubTeam[] = [
  { name: 'Discord Bot', slug: 'discord-bot' },
  { name: 'Blue Book', slug: 'blue-book' },
]
const GITHUB_TEAM = 'Discord Bot'
const GITHUB_TEAM_SLUG = 'discord-bot'
const [GOOGLE_TEAM, GOOGLE_GROUP] = firstEntry(GoogleGroups, 'Google group')

const data = new EventData(Language.Default, Language.Default)
const targetUser = createMockUser({ id: 'target-1', tag: 'Target#0001' })

function createInteraction(
  service: string,
  team: string,
  role: string | null = null,
): ChatInputCommandInteraction {
  return {
    user: { tag: 'Director#0001' },
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'service') return service
        if (name === 'role') return role
        return team
      }),
      getUser: vi.fn(() => targetUser),
    },
  } as unknown as ChatInputCommandInteraction
}

/** An autocomplete interaction for the `team` option, with `service` maybe unset. */
function createAutocompleteInteraction(service: string | null): AutocompleteInteraction {
  return {
    options: { getString: vi.fn(() => service) },
  } as unknown as AutocompleteInteraction
}

function focusedTeam(value: string): AutocompleteFocusedOption {
  return { name: 'team', value } as AutocompleteFocusedOption
}

/** The embed description and ephemeral flag of the most recent reply. */
function lastSent(): { description: string; ephemeral: boolean } {
  const calls = sendMock.mock.calls as unknown as [unknown, EmbedBuilder, boolean][]
  const call = calls[calls.length - 1]
  if (!call) throw new Error('no reply was sent')
  return { description: call[1].data.description ?? '', ephemeral: call[2] }
}

function githubService(
  addMember: GitHubTeamsService['addMember'],
  isConfigured = true,
  teams: GitHubTeam[] = GITHUB_TEAMS,
): GitHubTeamsService {
  return {
    isConfigured: () => isConfigured,
    addMember,
    getTeams: () => teams,
    warmTeams: vi.fn(),
  } as unknown as GitHubTeamsService
}

function googleService(
  addMember: GoogleGroupsService['addMember'],
  isConfigured = true,
): GoogleGroupsService {
  return { isConfigured: () => isConfigured, addMember } as unknown as GoogleGroupsService
}

function userService(linked: LinkedAccount | undefined | Error): UserService {
  return {
    findLinkedAccount: vi.fn(async () => {
      if (linked instanceof Error) throw linked
      return linked
    }),
  } as unknown as UserService
}

function linkedAccount(overrides: Partial<LinkedAccount>): LinkedAccount {
  return {
    discordUserId: targetUser.id,
    provider: 'github',
    externalId: 'octocat',
    email: null,
    ...overrides,
  } as LinkedAccount
}

describe('GrantAccessCommand', () => {
  beforeEach(() => {
    sendMock.mockClear()
  })

  describe('autocomplete', () => {
    const command = new GrantAccessCommand(
      undefined,
      undefined,
      githubService(vi.fn(async () => ({ status: 'active' as const }))),
    )
    // Team names as autocomplete offers them: discovered, then sorted by name.
    const githubNames = ['Blue Book', 'Discord Bot']

    it('suggests only the Google teams once google is picked', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction('google'),
        focusedTeam(''),
      )

      expect(choices.map((choice) => choice.value)).toEqual(Object.keys(GoogleGroups).sort())
    })

    it('suggests only the GitHub teams once github is picked', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction('github'),
        focusedTeam(''),
      )

      expect(choices.map((choice) => choice.value)).toEqual(githubNames)
    })

    it('suggests every team while the service is still unset', async () => {
      // Discord asks for team suggestions before the service option is filled in.
      const choices = await command.autocomplete(
        createAutocompleteInteraction(null),
        focusedTeam(''),
      )

      expect(choices.map((choice) => choice.value)).toEqual(
        Array.from(new Set([...Object.keys(GoogleGroups), ...githubNames])).sort(),
      )
    })

    it('falls back to every team for a service it does not know', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction('gitlab'),
        focusedTeam(''),
      )

      expect(choices.length).toBeGreaterThan(0)
    })

    it('matches the typed text anywhere in the name, ignoring case', async () => {
      const firstGitHubTeam = githubNames[0]!
      const fragment = firstGitHubTeam.slice(1, 4).toUpperCase()

      const choices = await command.autocomplete(
        createAutocompleteInteraction('github'),
        focusedTeam(fragment),
      )

      expect(choices.map((choice) => choice.value)).toContain(firstGitHubTeam)
      for (const choice of choices) {
        expect(choice.value.toString().toLowerCase()).toContain(fragment.toLowerCase())
      }
    })

    it('returns nothing when the typed text matches no team', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction('github'),
        focusedTeam('zzz-no-such-team'),
      )

      expect(choices).toEqual([])
    })

    it('labels each choice with the shortname it submits', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction('github'),
        focusedTeam(''),
      )

      for (const choice of choices) {
        expect(choice.name).toBe(choice.value)
      }
    })

    it('offers nothing for GitHub while the discovered team list is still cold', async () => {
      // A cold cache costs suggestions only; the team can still be typed.
      const coldCommand = new GrantAccessCommand(
        undefined,
        undefined,
        githubService(
          vi.fn(async () => ({ status: 'active' as const })),
          true,
          [],
        ),
      )

      const choices = await coldCommand.autocomplete(
        createAutocompleteInteraction('github'),
        focusedTeam(''),
      )

      expect(choices).toEqual([])
    })

    it('never returns more choices than Discord accepts', async () => {
      const choices = await command.autocomplete(
        createAutocompleteInteraction(null),
        focusedTeam(''),
      )

      expect(choices.length).toBeLessThanOrEqual(DiscordLimits.CHOICES_PER_AUTOCOMPLETE)
    })
  })

  it('rejects a service it has no handler for', async () => {
    const command = new GrantAccessCommand()

    await command.execute(createInteraction('gitlab', GITHUB_TEAM), data)

    expect(lastSent().description).toContain('Unsupported service')
  })

  describe('github', () => {
    it('adds the linked username to the configured org team', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(addMember).toHaveBeenCalledWith(GITHUB_TEAM_SLUG, 'octocat', 'member')
      const sent = lastSent()
      expect(sent.description).toContain('was added')
      expect(sent.ephemeral).toBe(false)
    })

    it('grants the member role when none is picked', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(addMember).toHaveBeenCalledWith(GITHUB_TEAM_SLUG, 'octocat', 'member')
      expect(lastSent().description).toContain('Member')
    })

    it('passes the maintainer role through and names it in the reply', async () => {
      // A maintainer grant must not read the same as a member grant: it hands
      // the target the ability to manage that team's membership on GitHub.
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM, 'maintainer'), data)

      expect(addMember).toHaveBeenCalledWith(GITHUB_TEAM_SLUG, 'octocat', 'maintainer')
      expect(lastSent().description).toContain('Maintainer')
    })

    it('falls back to member for a role it does not recognize', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM, 'owner'), data)

      expect(addMember).toHaveBeenCalledWith(GITHUB_TEAM_SLUG, 'octocat', 'member')
    })

    it('names the role on a pending invite too', async () => {
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(vi.fn(async () => ({ status: 'pending' as const }))),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM, 'maintainer'), data)

      const sent = lastSent()
      expect(sent.description).toContain('Maintainer')
      expect(sent.description).toContain('octocat')
    })

    it('names the invited username while the invite is pending', async () => {
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(vi.fn(async () => ({ status: 'pending' as const }))),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      const sent = lastSent()
      expect(sent.description).toContain('octocat')
      expect(sent.description).toContain('invite')
      expect(sent.ephemeral).toBe(false)
    })

    it('resolves a team the caller typed as a slug', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM_SLUG), data)

      expect(addMember).toHaveBeenCalledWith(GITHUB_TEAM_SLUG, 'octocat', 'member')
    })

    it('attempts a team the cache has not seen, letting GitHub decide', async () => {
      // A team created since the last refresh must still be grantable by
      // typing its name; GitHub rejects the slug if it truly does not exist.
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember, true, []),
      )

      await command.execute(createInteraction('github', 'Brand New Team'), data)

      expect(addMember).toHaveBeenCalledWith('brand-new-team', 'octocat', 'member')
    })

    it('reports an unusable team name without calling GitHub', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({})),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', '---'), data)

      expect(addMember).not.toHaveBeenCalled()
      const sent = lastSent()
      expect(sent.description).toContain('Unknown team')
      expect(sent.description).toContain('GitHub team')
      expect(sent.ephemeral).toBe(true)
    })

    it('passes a typed inherited key through as an ordinary slug', async () => {
      // `team` is autocompleted, so anything can be typed into it. Teams are
      // matched over an array now, so no prototype value can be reached.
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({ externalId: 'octocat' })),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', '__proto__'), data)

      expect(addMember).toHaveBeenCalledWith('proto', 'octocat', 'member')
    })

    it('reports a missing GitHub token', async () => {
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({})),
        githubService(
          vi.fn(async () => ({ status: 'not-configured' as const })),
          false,
        ),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(lastSent().description).toContain("isn't configured")
    })

    it('reports a missing user service', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(undefined, undefined, githubService(addMember))

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(addMember).not.toHaveBeenCalled()
      expect(lastSent().description).toContain("isn't configured")
    })

    it('tells the caller to link the account first', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(undefined),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(addMember).not.toHaveBeenCalled()
      const sent = lastSent()
      expect(sent.description).toContain('GitHub')
      expect(sent.description).toContain('/link-account')
      expect(sent.ephemeral).toBe(true)
    })

    it('does not call GitHub when the account lookup fails', async () => {
      const addMember = vi.fn(async () => ({ status: 'active' as const }))
      const command = new GrantAccessCommand(
        undefined,
        userService(new Error('database is locked')),
        githubService(addMember),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      expect(addMember).not.toHaveBeenCalled()
      expect(lastSent().description).toContain("isn't configured")
    })

    it('reports a failed API call', async () => {
      const command = new GrantAccessCommand(
        undefined,
        userService(linkedAccount({})),
        githubService(vi.fn(async () => ({ status: 'error' as const, message: '403 Forbidden' }))),
      )

      await command.execute(createInteraction('github', GITHUB_TEAM), data)

      const sent = lastSent()
      expect(sent.description).toContain("Couldn't add")
      expect(sent.ephemeral).toBe(true)
    })
  })

  describe('google', () => {
    it('adds the linked email to the configured group', async () => {
      const addMember = vi.fn(async () => ({ status: 'added' as const }))
      const command = new GrantAccessCommand(
        googleService(addMember),
        userService(linkedAccount({ provider: 'google', email: 'you@example.com' })),
      )

      await command.execute(createInteraction('google', GOOGLE_TEAM), data)

      expect(addMember).toHaveBeenCalledWith(GOOGLE_GROUP, 'you@example.com')
      const sent = lastSent()
      expect(sent.description).toContain('was added')
      expect(sent.ephemeral).toBe(false)
    })

    it('reports an existing membership as a success', async () => {
      const command = new GrantAccessCommand(
        googleService(vi.fn(async () => ({ status: 'already-member' as const }))),
        userService(linkedAccount({ provider: 'google', email: 'you@example.com' })),
      )

      await command.execute(createInteraction('google', GOOGLE_TEAM), data)

      const sent = lastSent()
      expect(sent.description).toContain('already a member')
      expect(sent.ephemeral).toBe(false)
    })

    it('tells the caller to link a Google account when no email is stored', async () => {
      const addMember = vi.fn(async () => ({ status: 'added' as const }))
      const command = new GrantAccessCommand(
        googleService(addMember),
        userService(linkedAccount({ provider: 'google', email: null })),
      )

      await command.execute(createInteraction('google', GOOGLE_TEAM), data)

      expect(addMember).not.toHaveBeenCalled()
      expect(lastSent().description).toContain('Google')
    })

    it('reports an unknown team without calling Google', async () => {
      const addMember = vi.fn(async () => ({ status: 'added' as const }))
      const command = new GrantAccessCommand(
        googleService(addMember),
        userService(linkedAccount({ provider: 'google', email: 'you@example.com' })),
      )

      await command.execute(createInteraction('google', 'Not A Team'), data)

      expect(addMember).not.toHaveBeenCalled()
      const sent = lastSent()
      expect(sent.description).toContain('Unknown team')
      expect(sent.description).toContain('Google Group')
    })

    it('rejects a typed inherited key instead of calling Google with a bogus address', async () => {
      const addMember = vi.fn(async () => ({ status: 'added' as const }))
      const command = new GrantAccessCommand(
        googleService(addMember),
        userService(linkedAccount({ provider: 'google', email: 'you@example.com' })),
      )

      await command.execute(createInteraction('google', 'toString'), data)

      expect(addMember).not.toHaveBeenCalled()
      expect(lastSent().description).toContain('Unknown team')
    })

    it('reports a failed API call', async () => {
      const command = new GrantAccessCommand(
        googleService(vi.fn(async () => ({ status: 'error' as const, message: '500' }))),
        userService(linkedAccount({ provider: 'google', email: 'you@example.com' })),
      )

      await command.execute(createInteraction('google', GOOGLE_TEAM), data)

      const sent = lastSent()
      expect(sent.description).toContain("Couldn't add")
      expect(sent.ephemeral).toBe(true)
    })
  })
})
