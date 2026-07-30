import { Collection, type Guild, type GuildMember, type Role } from 'discord.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { type ServerRole, ServerRoles } from '../../src/constants/index.js'
import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

function createRole(id: string, name: string): Role {
  return { id, name } as Role
}

function createRoleCollection(roles: Role[]): Collection<string, Role> {
  return new Collection<string, Role>(roles.map((role) => [role.id, role]))
}

function createMember(memberRoles: Role[], guildRoles: Role[]): GuildMember {
  const guild = {
    roles: {
      cache: createRoleCollection(guildRoles),
    },
  } as Guild

  return {
    guild,
    roles: {
      cache: createRoleCollection(memberRoles),
    },
  } as GuildMember
}

describe('UserService.getActiveRoles', () => {
  it('returns exactly the configured roles the member holds, as a flat list', () => {
    const admin = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const director = createRole(ServerRoles.DIRECTOR.id, ServerRoles.DIRECTOR.name)
    const unrelated = createRole('some-other-role', 'Some Other Role')
    const member = createMember([admin, director, unrelated], [admin, director, unrelated])

    const active = UserService.getActiveRoles(member)

    expect(active.map((role) => role.key).sort()).toEqual(['ADMIN', 'DIRECTOR'])
    expect(active).toContainEqual({ key: 'ADMIN', ...ServerRoles.ADMIN })
    expect(active).toContainEqual({ key: 'DIRECTOR', ...ServerRoles.DIRECTOR })
  })

  it('discovers a role held by configured name when the configured id is absent', () => {
    const localAdmin = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const member = createMember([localAdmin], [localAdmin])

    expect(UserService.getActiveRoleKeys(member)).toEqual(['ADMIN'])
  })

  it('returns an empty list when the member holds no configured roles', () => {
    const unrelated = createRole('some-other-role', 'Some Other Role')
    const member = createMember([unrelated], [unrelated])

    expect(UserService.getActiveRoles(member)).toEqual([])
  })

  it('scopes discovery to an injected catalog', () => {
    const catalog = { ADMIN: ServerRoles.ADMIN } as Record<'ADMIN', ServerRole>
    const admin = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const director = createRole(ServerRoles.DIRECTOR.id, ServerRoles.DIRECTOR.name)
    const member = createMember([admin, director], [admin, director])

    expect(
      UserService.getActiveRoleKeys(member, catalog as unknown as typeof ServerRoles),
    ).toEqual(['ADMIN'])
  })
})

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

describe('UserService access grants', () => {
  let service: UserService

  beforeEach(() => {
    service = new UserService(createTestDatabase())
  })

  async function linkGoogle(discordUserId: string): Promise<number> {
    await service.linkAccount(discordUserId, 'google', { externalId: `${discordUserId}@example.com` })
    const [account] = await service.listLinkedAccounts(discordUserId)
    return account.id
  }

  it('returns an empty array for a user with no grants', async () => {
    await linkGoogle('user-1')
    expect(await service.listAccessGrants('user-1')).toEqual([])
  })

  it('records grants and returns them scoped to the user', async () => {
    const accountId = await linkGoogle('user-1')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')
    await service.recordAccessGrant(accountId, 'organizers', 'organizers@example.com')

    const grants = await service.listAccessGrants('user-1')

    expect(grants.map((g) => g.team).sort()).toEqual(['organizers', 'welcome'])
    expect(grants.every((g) => g.linkedAccountId === accountId)).toBe(true)
    expect(grants.find((g) => g.team === 'welcome')?.groupAddress).toBe('welcome@example.com')
    expect(grants[0].grantedAt).toBeInstanceOf(Date)
  })

  it('upserts on re-granting the same team rather than duplicating', async () => {
    const accountId = await linkGoogle('user-1')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome-renamed@example.com')

    const grants = await service.listAccessGrants('user-1')

    expect(grants).toHaveLength(1)
    expect(grants[0].groupAddress).toBe('welcome-renamed@example.com')
  })

  it("does not leak another user's grants", async () => {
    const account1 = await linkGoogle('user-1')
    const account2 = await linkGoogle('user-2')
    await service.recordAccessGrant(account1, 'welcome', 'welcome@example.com')
    await service.recordAccessGrant(account2, 'organizers', 'organizers@example.com')

    const grants = await service.listAccessGrants('user-1')

    expect(grants).toHaveLength(1)
    expect(grants[0].team).toBe('welcome')
  })
})
