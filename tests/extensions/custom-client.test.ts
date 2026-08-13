import { Collection, type Guild, type GuildMember } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomClient } from '../../src/extensions/custom-client.js'
import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const USER_ID = '123456789012345678'
const EMAIL = 'a@example.com'

/**
 * A member carrying only what `getUserInfo` reads. `roles.cache` and
 * `guild.roles.cache` must be real Collections — `UserService.getActiveRoles`
 * walks them via `RoleUtils`.
 */
function createMember(): GuildMember {
  return {
    id: USER_ID,
    user: {
      username: 'testuser',
      avatarURL: (): string | null => null,
    },
    displayName: 'Test User',
    joinedAt: new Date('2024-01-01T00:00:00.000Z'),
    avatarURL: (): string | null => null,
    guild: { roles: { cache: new Collection() } },
    roles: { cache: new Collection() },
  } as unknown as GuildMember
}

describe('CustomClient.getUserInfo', () => {
  let client: CustomClient
  let service: UserService

  beforeEach(() => {
    client = new CustomClient({ intents: [] })
    service = new UserService(createTestDatabase())
    client.userService = service

    const guild = {
      members: { fetch: vi.fn().mockResolvedValue(createMember()) },
    } as unknown as Guild
    vi.spyOn(client.guilds.cache, 'get').mockReturnValue(guild)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function linkAccount(): Promise<number> {
    await service.linkAccount(USER_ID, 'google', { externalId: EMAIL, email: EMAIL })
    const [account] = await service.listLinkedAccounts(USER_ID)
    return account.id
  }

  it('carries the account address as externalId, not username', async () => {
    await linkAccount()

    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    expect(info?.access[0].externalId).toBe(EMAIL)
    expect(info?.access[0]).not.toHaveProperty('username')
  })

  it('reports a team once when a recorded grant and its pending row coexist', async () => {
    // Pending rows survive materialization, so after `/backfill-grants` the same
    // team exists in both tables — the API must not report it twice.
    await service.recordPendingAccessGrant('google', EMAIL, 'welcome', 'pending@x.org')
    const accountId = await linkAccount()
    await service.recordAccessGrant(accountId, 'welcome', 'recorded@x.org')

    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    expect(info?.access[0].grants).toHaveLength(1)
    expect(info?.access[0].grants[0].groupAddress).toBe('recorded@x.org')
  })

  it('reports a pending grant discovered after the link, dated when it was found', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await linkAccount()

    // The backfill ran after the account was linked, so this was never materialized.
    const discovered = new Date('2026-07-01T00:00:00.000Z')
    vi.setSystemTime(discovered)
    await service.recordPendingAccessGrant('google', EMAIL, 'organizers', 'org@x.org')
    vi.useRealTimers()

    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    expect(info?.access[0].grants).toEqual([
      { team: 'organizers', groupAddress: 'org@x.org', grantedAt: discovered.toISOString() },
    ])
  })

  it('returns null when the guild is not on this shard', async () => {
    vi.spyOn(client.guilds.cache, 'get').mockReturnValue(undefined)

    expect(await client.getUserInfo(GUILD_ID, USER_ID)).toBeNull()
  })
})
