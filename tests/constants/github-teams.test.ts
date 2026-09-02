import { describe, expect, it } from 'vitest'

import { getGitHubTeam, GitHubTeams } from '../../src/constants/github-teams.js'

describe('GitHubTeams', () => {
  it('loads every configured team as an org + team slug pair', () => {
    const entries = Object.entries(GitHubTeams)

    expect(entries.length).toBeGreaterThan(0)
    for (const [shortname, ref] of entries) {
      expect(shortname, 'team shortname').not.toBe('')
      expect(typeof ref.org, `${shortname}.org`).toBe('string')
      expect(typeof ref.team, `${shortname}.team`).toBe('string')
      expect(ref.org).not.toBe('')
      expect(ref.team).not.toBe('')
    }
  })

  it('resolves a configured shortname to its team ref', () => {
    const [shortname, ref] = Object.entries(GitHubTeams)[0]!

    expect(getGitHubTeam(shortname)).toEqual(ref)
  })

  it('returns null for an unknown shortname', () => {
    expect(getGitHubTeam('Not A Team')).toBeNull()
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'returns null for the inherited key %j',
    (key) => {
      // The `team` option is autocompleted, not choice-restricted, so any of
      // these can arrive as typed input.
      expect(getGitHubTeam(key)).toBeNull()
    },
  )
})
