import { describe, expect, it } from 'vitest'

import { validateAllowedRoleKeys } from '../../src/constants/server-roles.js'

describe('validateAllowedRoleKeys', () => {
  it('returns the configured role keys', () => {
    expect(validateAllowedRoleKeys(['ADMIN', 'DIRECTOR'], 'config.test', '/test')).toEqual([
      'ADMIN',
      'DIRECTOR',
    ])
  })

  it('fails closed on an empty or missing list by default', () => {
    expect(() => validateAllowedRoleKeys([], 'config.test', '/test')).toThrow(
      /must list at least one role key/,
    )
    expect(() => validateAllowedRoleKeys(undefined, 'config.test', '/test')).toThrow(
      /must list at least one role key/,
    )
  })

  it('allows an empty or missing list when the caller opts in to being unrestricted', () => {
    expect(validateAllowedRoleKeys([], 'config.test', '/test', { allowEmpty: true })).toEqual([])
    expect(
      validateAllowedRoleKeys(undefined, 'config.test', '/test', { allowEmpty: true }),
    ).toEqual([])
  })

  it('still rejects unknown role keys when an empty list is allowed', () => {
    expect(() =>
      validateAllowedRoleKeys(['ADMNI'], 'config.test', '/test', { allowEmpty: true }),
    ).toThrow(/unknown role keys: ADMNI/)
  })
})
