import {
  Collection,
  DiscordAPIError,
  type Guild,
  type GuildMember,
  RateLimitError,
  RESTJSONErrorCodes,
} from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CustomClient } from '../../src/extensions/custom-client.js'
import { Logger } from '../../src/services/logger.js'
import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const USER_ID = '123456789012345678'

interface MemberOverrides {
  id?: string
  joinedAt?: Date | null
  guildAvatar?: string | null
  globalAvatar?: string | null
}

function createMember(overrides: MemberOverrides = {}): GuildMember {
  const {
    id = USER_ID,
    joinedAt = new Date('2024-01-02T03:04:05.000Z'),
    guildAvatar = 'https://cdn.example/guild.png',
    globalAvatar = 'https://cdn.example/global.png',
  } = overrides

  return {
    id,
    displayName: 'Test Display Name',
    joinedAt,
    user: {
      username: 'testuser',
      avatarURL: () => globalAvatar,
    },
    avatarURL: () => guildAvatar,
    // No configured roles held, so `getActiveRoles` returns []. Role resolution
    // itself is covered by user-service.test.ts.
    guild: { roles: { cache: new Collection() } } as unknown as Guild,
    roles: { cache: new Collection() },
  } as unknown as GuildMember
}

/**
 * A `CustomClient` without running the real constructor: instantiating one
 * requires full `ClientOptions` and starts discord.js internals we don't want in
 * a unit test. `getUserInfo` only touches `this.guilds.cache` and
 * `this.userService`, so those are all it needs.
 */
function createClient(options: {
  member?: GuildMember | null
  fetchError?: unknown
  userService?: UserService
  guildId?: string
}): CustomClient {
  const client = Object.create(CustomClient.prototype) as CustomClient

  const guild = {
    members: {
      fetch: vi.fn().mockImplementation(() => {
        // `in`, not truthiness, so a test can reject with null/undefined.
        if ('fetchError' in options) return Promise.reject(options.fetchError)
        return Promise.resolve(options.member)
      }),
    },
  }

  Object.defineProperty(client, 'guilds', {
    value: { cache: new Collection([[options.guildId ?? GUILD_ID, guild]]) },
    configurable: true,
  })
  client.userService = options.userService

  return client
}

/**
 * A real `DiscordAPIError`, not a hand-rolled `{ code }` stub: the whole fix
 * rests on discord.js putting Discord's numeric body code on `.code`, so the
 * tests must break if that shape ever changes.
 */
const MEMBER_ROUTE = 'https://discord.com/api/v10/guilds/1/members/2'

function discordError(code: number, message = `Discord error ${code}`): DiscordAPIError {
  // Both unknown-* codes come back as 404 from GET /guilds/:id/members/:id.
  const status =
    code === RESTJSONErrorCodes.UnknownMember || code === RESTJSONErrorCodes.UnknownUser ? 404 : 403
  return new DiscordAPIError({ code, message }, code, status, 'GET', MEMBER_ROUTE, {})
}

/** A real rate-limit rejection, which carries no `.code` at all. */
function rateLimitError(): RateLimitError {
  return new RateLimitError({
    timeToReset: 1000,
    limit: 5,
    method: 'GET',
    hash: 'abcd1234',
    url: MEMBER_ROUTE,
    route: '/guilds/:id/members/:id',
    majorParameter: '1',
    global: false,
    retryAfter: 1000,
    sublimitTimeout: 0,
    scope: 'user',
  })
}

/** The single linked account under test, asserted to exist so callers get a value. */
async function onlyLinkedAccount(userService: UserService) {
  const [account] = await userService.listLinkedAccounts(USER_ID)
  if (!account) throw new Error('expected a linked account to have been created')
  return account
}

describe('CustomClient.getUserInfo', () => {
  let userService: UserService

  beforeEach(() => {
    userService = new UserService(createTestDatabase())
  })

  it('returns null when the guild is not on this shard', async () => {
    const client = createClient({ member: createMember(), userService })

    expect(await client.getUserInfo('999999999999999999', USER_ID)).toBeNull()
  })

  it('returns null when the member fetch rejects with Unknown Member', async () => {
    const client = createClient({
      fetchError: discordError(RESTJSONErrorCodes.UnknownMember),
      userService,
    })

    expect(await client.getUserInfo(GUILD_ID, USER_ID)).toBeNull()
  })

  it('returns null when the member fetch rejects with Unknown User', async () => {
    const client = createClient({
      fetchError: discordError(RESTJSONErrorCodes.UnknownUser),
      userService,
    })

    expect(await client.getUserInfo(GUILD_ID, USER_ID)).toBeNull()
  })

  it.each([
    ['missing access', () => discordError(RESTJSONErrorCodes.MissingAccess, 'Missing Access')],
    ['a rate limit (no `code`)', rateLimitError],
    [
      'a socket failure (string `code`)',
      () =>
        Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
        }),
    ],
    ['a non-Error rejection', () => 'something threw a string'],
  ])('propagates %s rather than reporting the member as absent', async (_label, makeError) => {
    const error = makeError()
    const client = createClient({ fetchError: error, userService })

    // The controller turns this into a 503; a null would become a 404 and tell
    // the caller this member definitively has no roles or access. Asserting on
    // the identical value, so a catch that rethrows something else still fails.
    await expect(client.getUserInfo(GUILD_ID, USER_ID)).rejects.toBe(error)
  })

  it('propagates an empty rejection without the code check throwing first', async () => {
    const client = createClient({ fetchError: undefined, userService })

    // Reading `.code` off undefined would replace the real failure with a
    // confusing TypeError in the logs.
    await expect(client.getUserInfo(GUILD_ID, USER_ID)).rejects.toBeUndefined()
  })

  it('returns null when the fetch resolves without a member', async () => {
    const client = createClient({ member: null, userService })

    expect(await client.getUserInfo(GUILD_ID, USER_ID)).toBeNull()
  })

  it('groups access grants under the linked account they belong to', async () => {
    await userService.linkAccount(USER_ID, 'google', {
      externalId: 'member@example.org',
      displayName: 'Test Member',
    })
    const account = await onlyLinkedAccount(userService)
    await userService.recordAccessGrant(account.id, 'field', 'field@example.org')
    await userService.recordAccessGrant(account.id, 'data', 'data@example.org')

    const client = createClient({ member: createMember(), userService })
    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    const [linked] = info?.access ?? []
    expect(info?.access).toHaveLength(1)
    expect(linked?.externalId).toBe('member@example.org')
    expect(linked?.grants.map((grant) => grant.team).sort()).toEqual(['data', 'field'])
    expect(linked?.grants[0]?.grantedAt).toEqual(expect.any(String))
  })

  it('reports a linked account with no grants as an empty grant list', async () => {
    await userService.linkAccount(USER_ID, 'google', {
      externalId: 'member@example.org',
    })

    const client = createClient({ member: createMember(), userService })
    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    expect(info?.access).toHaveLength(1)
    expect(info?.access?.[0]?.grants).toEqual([])
    // `displayName` was never supplied, so it must round-trip as null, not undefined.
    expect(info?.access?.[0]?.displayName).toBeNull()
  })

  it('omits `access` entirely when there is no userService, rather than reporting none', async () => {
    const client = createClient({ member: createMember(), userService: undefined })

    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    // `access: []` here would read as "linked nothing" to a consumer using this
    // for authorization; absence is the honest answer for a DB-less deployment.
    expect(info).not.toBeNull()
    expect(info?.access).toBeUndefined()
    expect('access' in info!).toBe(false)
    // Still a complete answer for everything that doesn't need the DB.
    expect(info?.userId).toBe(USER_ID)
  })

  it('warns once about the missing userService, not on every request', async () => {
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    const client = createClient({ member: createMember(), userService: undefined })

    await client.getUserInfo(GUILD_ID, USER_ID)
    await client.getUserInfo(GUILD_ID, USER_ID)
    await client.getUserInfo(GUILD_ID, USER_ID)

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('prefers the guild avatar, then the global avatar, then null', async () => {
    const both = createClient({ member: createMember(), userService })
    expect((await both.getUserInfo(GUILD_ID, USER_ID))?.avatarUrl).toBe(
      'https://cdn.example/guild.png',
    )

    const globalOnly = createClient({
      member: createMember({ guildAvatar: null }),
      userService,
    })
    expect((await globalOnly.getUserInfo(GUILD_ID, USER_ID))?.avatarUrl).toBe(
      'https://cdn.example/global.png',
    )

    const neither = createClient({
      member: createMember({ guildAvatar: null, globalAvatar: null }),
      userService,
    })
    expect((await neither.getUserInfo(GUILD_ID, USER_ID))?.avatarUrl).toBeNull()
  })

  it('serializes joinedAt as ISO-8601, and null when the member has none', async () => {
    const joined = createClient({ member: createMember(), userService })
    expect((await joined.getUserInfo(GUILD_ID, USER_ID))?.joinedAt).toBe('2024-01-02T03:04:05.000Z')

    // Real for uncached/partial members.
    const unknown = createClient({ member: createMember({ joinedAt: null }), userService })
    expect((await unknown.getUserInfo(GUILD_ID, USER_ID))?.joinedAt).toBeNull()
  })

  it('returns a JSON-serializable payload, as the broadcastEval IPC boundary requires', async () => {
    await userService.linkAccount(USER_ID, 'google', {
      externalId: 'member@example.org',
      displayName: 'Test Member',
    })
    const account = await onlyLinkedAccount(userService)
    await userService.recordAccessGrant(account.id, 'field', 'field@example.org')

    const client = createClient({ member: createMember(), userService })
    const info = await client.getUserInfo(GUILD_ID, USER_ID)

    // Dates that leaked through as Date objects would arrive as strings on the
    // manager side anyway; asserting the round trip keeps the contract honest.
    expect(JSON.parse(JSON.stringify(info))).toEqual(info)
    expect(info).toMatchObject({
      userId: USER_ID,
      username: 'testuser',
      displayName: 'Test Display Name',
      roles: [],
    })
  })
})
