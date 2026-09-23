import { describe, expect, it } from 'vitest'

import { getLinkableAccount, LinkableAccounts } from '../../src/constants/linkable-accounts.js'

/** Fails loudly rather than silently skipping if a provider is removed. */
function accountFor(provider: string): (typeof LinkableAccounts)[number] {
  const account = getLinkableAccount(provider)
  if (!account) throw new Error(`no linkable account configured for '${provider}'`)
  return account
}

describe('LinkableAccounts', () => {
  it('exposes each provider exactly once', () => {
    const providers = LinkableAccounts.map((account) => account.provider)

    expect(providers).toEqual([...new Set(providers)])
    expect(providers).toEqual(expect.arrayContaining(['google', 'github']))
  })

  it('returns undefined for an unknown provider', () => {
    expect(getLinkableAccount('gitlab')).toBeUndefined()
  })

  describe('google', () => {
    const google = accountFor('google')

    it.each(['you@example.com', 'first.last+tag@sub.example.org', '  spaced@example.com  '])(
      'accepts %j',
      (identifier) => {
        expect(google.validate(identifier)).toBe(true)
      },
    )

    it.each([
      '',
      '   ',
      'nope',
      'no-at-sign.com',
      'no@domain',
      'two@@example.com',
      'a b@example.com',
    ])('rejects %j', (identifier) => {
      expect(google.validate(identifier)).toBe(false)
    })

    it('stores the email lowercased and trimmed as both id and email', () => {
      expect(google.normalize('  You@Example.COM ')).toEqual({
        externalId: 'you@example.com',
        email: 'you@example.com',
      })
    })
  })

  describe('github', () => {
    const github = accountFor('github')

    it.each(['octocat', 'Octo-Cat', 'a', '0', '  spaced-name  ', 'a'.repeat(39)])(
      'accepts %j',
      (identifier) => {
        expect(github.validate(identifier)).toBe(true)
      },
    )

    it.each([
      '',
      '   ',
      '-leading',
      'trailing-',
      'double--hyphen',
      'has space',
      'under_score',
      'exclaim!',
      'a'.repeat(40),
    ])('rejects %j', (identifier) => {
      expect(github.validate(identifier)).toBe(false)
    })

    it('lowercases the username so one GitHub account cannot be linked twice', () => {
      // GitHub usernames are case-insensitive; the (provider, external_id)
      // unique index is not.
      expect(github.normalize('  OctoCat ')).toEqual({ externalId: 'octocat', email: undefined })
    })
  })
})
