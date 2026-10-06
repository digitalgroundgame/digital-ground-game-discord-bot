import { describe, expect, it } from 'vitest'

import { getGoogleGroupAddress, GoogleGroups } from '../../src/constants/google-groups.js'

describe('GoogleGroups', () => {
  it('loads every configured team as a group address', () => {
    const entries = Object.entries(GoogleGroups)

    expect(entries.length).toBeGreaterThan(0)
    for (const [shortname, address] of entries) {
      expect(shortname, 'team shortname').not.toBe('')
      expect(address, `${shortname} address`).toContain('@')
    }
  })

  it('resolves a configured shortname to its group address', () => {
    const [shortname, address] = Object.entries(GoogleGroups)[0]!

    expect(getGoogleGroupAddress(shortname)).toBe(address)
  })

  it('returns null for an unknown shortname', () => {
    expect(getGoogleGroupAddress('Not A Team')).toBeNull()
  })

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'returns null for the inherited key %j',
    (key) => {
      // The `team` option is autocompleted, not choice-restricted, so any of
      // these can arrive as typed input.
      expect(getGoogleGroupAddress(key)).toBeNull()
    },
  )
})
