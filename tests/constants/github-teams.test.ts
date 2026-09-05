import { describe, expect, it } from 'vitest'

import {
  type GitHubTeam,
  GitHubExcludedTeamSlugs,
  isExcludedGitHubTeam,
  resolveGitHubTeamSlug,
  selectableGitHubTeams,
  toGitHubTeamSlug,
} from '../../src/constants/github-teams.js'

/** A discovered org team list, in the arbitrary order GitHub returns it. */
const teams: GitHubTeam[] = [
  { name: 'Discord Bot', slug: 'discord-bot' },
  { name: 'Blue Book', slug: 'blue-book' },
  { name: 'Leadership', slug: 'leadership' },
]

describe('toGitHubTeamSlug', () => {
  it.each([
    ['Blue Book', 'blue-book'],
    ['CRM', 'crm'],
    ['Pragmatic Papers Website', 'pragmatic-papers-website'],
    ['SSO Hub', 'sso-hub'],
    ['  Dev   Team  ', 'dev-team'],
    ['Rock & Roll', 'rock-roll'],
    ['Team (2026)', 'team-2026'],
  ])('slugifies %j to %j the way GitHub does', (name, slug) => {
    expect(toGitHubTeamSlug(name)).toBe(slug)
  })

  it('leaves an already-slugged name alone', () => {
    expect(toGitHubTeamSlug('discord-bot')).toBe('discord-bot')
  })

  it('never leaves a leading or trailing hyphen', () => {
    expect(toGitHubTeamSlug('!! Media Team !!')).toBe('media-team')
  })

  it('returns an empty string when nothing survives slugging', () => {
    expect(toGitHubTeamSlug('---')).toBe('')
  })
})

describe('isExcludedGitHubTeam', () => {
  const excluded = new Set(['leadership'])

  it('denies a slug on the list regardless of case or padding', () => {
    expect(isExcludedGitHubTeam('leadership', excluded)).toBe(true)
    expect(isExcludedGitHubTeam('  LEADERSHIP ', excluded)).toBe(true)
  })

  it('allows a slug that is not on the list', () => {
    expect(isExcludedGitHubTeam('discord-bot', excluded)).toBe(false)
  })

  it('defaults to the configured exclusion set', () => {
    // Config ships with none excluded; this pins the default wiring, not the value.
    expect(isExcludedGitHubTeam('discord-bot')).toBe(GitHubExcludedTeamSlugs.has('discord-bot'))
  })
})

describe('selectableGitHubTeams', () => {
  it('drops excluded teams and sorts the rest by name', () => {
    const selectable = selectableGitHubTeams(teams, new Set(['leadership']))

    expect(selectable.map((team) => team.name)).toEqual(['Blue Book', 'Discord Bot'])
  })

  it('offers everything when nothing is excluded', () => {
    expect(selectableGitHubTeams(teams, new Set())).toHaveLength(teams.length)
  })

  it('is empty while the discovered team list is still cold', () => {
    expect(selectableGitHubTeams([], new Set())).toEqual([])
  })
})

describe('resolveGitHubTeamSlug', () => {
  const excluded = new Set(['leadership'])

  it('resolves a discovered team by its display name', () => {
    expect(resolveGitHubTeamSlug('Blue Book', teams, excluded)).toBe('blue-book')
  })

  it('resolves a discovered team by its slug', () => {
    expect(resolveGitHubTeamSlug('blue-book', teams, excluded)).toBe('blue-book')
  })

  it('ignores case and surrounding whitespace', () => {
    expect(resolveGitHubTeamSlug('  bLuE bOoK  ', teams, excluded)).toBe('blue-book')
  })

  it('falls back to the slug rule for a team created since the last refresh', () => {
    // The cache is a convenience; GitHub rejects the slug if it truly does not exist.
    expect(resolveGitHubTeamSlug('Brand New Team', teams, excluded)).toBe('brand-new-team')
  })

  it('still resolves against an empty cache', () => {
    expect(resolveGitHubTeamSlug('Blue Book', [], excluded)).toBe('blue-book')
  })

  it('denies an excluded team by name', () => {
    expect(resolveGitHubTeamSlug('Leadership', teams, excluded)).toBeNull()
  })

  it('denies an excluded team typed as a slug the cache does not hold', () => {
    // Otherwise the slug fallback would be a way around the exclusion list.
    expect(resolveGitHubTeamSlug('leadership', [], excluded)).toBeNull()
  })

  it.each(['', '   ', '---', '!!!'])('returns null for the unusable input %j', (input) => {
    expect(resolveGitHubTeamSlug(input, teams, excluded)).toBeNull()
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'treats the inherited key %j as ordinary text',
    (key) => {
      // `team` is autocompleted rather than choice-restricted, so any of these
      // can arrive as typed input. Lookups run over an array now, so these are
      // just names that GitHub will fail to find.
      const slug = resolveGitHubTeamSlug(key, teams, excluded)

      expect(slug === null || typeof slug === 'string').toBe(true)
      expect(teams.some((team) => team.slug === slug)).toBe(false)
    },
  )
})
