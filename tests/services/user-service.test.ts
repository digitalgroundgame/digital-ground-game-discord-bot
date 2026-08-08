import { Collection, type Guild, type GuildMember, type Role } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

    expect(UserService.getActiveRoles(member).map((role) => role.key)).toEqual(['ADMIN'])
    // The reported id must be the guild role the match was made on, not the
    // configured id — that id does not exist in this guild.
    expect(UserService.getActiveRoles(member)[0].id).toBe('local-admin-role')
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
      UserService.getActiveRoles(member, catalog as unknown as typeof ServerRoles).map(
        (role) => role.key,
      ),
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

  afterEach(() => {
    vi.useRealTimers()
  })

  async function linkGoogle(discordUserId: string): Promise<number> {
    await service.linkAccount(discordUserId, 'google', {
      externalId: `${discordUserId}@example.com`,
    })
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

  it('preserves grantedAt when the same team is re-granted', async () => {
    const accountId = await linkGoogle('user-1')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')
    const [first] = await service.listAccessGrants('user-1')

    // `/grant-access` records a grant even when the member is already in the
    // Group, so re-running it must not rewrite the original grant date.
    // Timestamps are second-resolution, so jump the clock rather than sleep.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 60_000))
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')
    vi.useRealTimers()
    const [second] = await service.listAccessGrants('user-1')

    expect(second.grantedAt).toEqual(first.grantedAt)
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime())
  })

  it('drops grants when the account is re-linked to a different address', async () => {
    const accountId = await linkGoogle('user-1')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')

    await service.linkAccount('user-1', 'google', { externalId: 'new@example.com' })

    // The grant belongs to the address that was actually added to the Group;
    // reporting it under the new address would over-report access.
    expect(await service.listAccessGrants('user-1')).toEqual([])
  })

  it('keeps grants when the same address is re-linked', async () => {
    const accountId = await linkGoogle('user-1')
    await service.recordAccessGrant(accountId, 'welcome', 'welcome@example.com')

    await service.linkAccount('user-1', 'google', {
      externalId: 'user-1@example.com',
      displayName: 'Updated Name',
    })

    expect(await service.listAccessGrants('user-1')).toHaveLength(1)
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
