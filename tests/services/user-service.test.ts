import { beforeEach, describe, expect, it } from 'vitest'

import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

describe('UserService.listLinkedAccounts', () => {
  let service: UserService

  beforeEach(() => {
    service = new UserService(createTestDatabase())
  })

  it('returns an empty array for a user with no linked accounts', async () => {
    expect(await service.listLinkedAccounts('unknown-user')).toEqual([])
  })

  it('returns every provider a user has linked, scoped to that user', async () => {
    await service.linkAccount('user-1', 'google', {
      externalId: 'a@example.com',
      email: 'a@example.com',
      displayName: 'User One',
    })
    await service.linkAccount('user-2', 'google', {
      externalId: 'b@example.com',
      email: 'b@example.com',
      displayName: 'User Two',
    })

    const accounts = await service.listLinkedAccounts('user-1')

    expect(accounts).toHaveLength(1)
    expect(accounts[0].provider).toBe('google')
    expect(accounts[0].email).toBe('a@example.com')
    expect(accounts[0].displayName).toBe('User One')
    expect(accounts[0].linkedAt).toBeInstanceOf(Date)
  })

  it('reflects the upserted row after re-linking the same provider', async () => {
    await service.linkAccount('user-1', 'google', { externalId: 'old@example.com' })
    await service.linkAccount('user-1', 'google', {
      externalId: 'new@example.com',
      email: 'new@example.com',
    })

    const accounts = await service.listLinkedAccounts('user-1')

    expect(accounts).toHaveLength(1)
    expect(accounts[0].externalId).toBe('new@example.com')
  })
})
