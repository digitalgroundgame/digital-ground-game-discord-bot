import { Collection, type GuildMember, type Role } from 'discord.js'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GuildMemberUpdateHandler } from '../../src/events/guild-member-update-handler.js'
import { type MemberUpdateUseCase } from '../../src/events/member-update-types.js'
import { Logger } from '../../src/services/logger.js'

// Load config.json the same way the handler does so a test can tweak the settings and the handler sees them
const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

// Minimal Role since the handler only ever looks at `id`
const role = (id: string) => ({ id }) as Role

// Fake member with just the `id` `roles.cache` and `user.bot` fields the handler reads
function member(roleIds: string[] = [], { id = 'member-1', bot = false } = {}): GuildMember {
  // Roles have to be a real Collection because the handler calls .filter() and .has()
  const roles = new Collection<string, Role>(roleIds.map((roleId) => [roleId, role(roleId)]))
  return { id, roles: { cache: roles }, user: { bot } } as unknown as GuildMember
}

// Fake use case whose `handle` is a mock so tests can check if it got called
function useCase(): MemberUpdateUseCase & { handle: ReturnType<typeof vi.fn> } {
  return { handle: vi.fn(async () => undefined) }
}

describe('GuildMemberUpdateHandler', () => {
  // Saved so afterEach can restore it
  const savedRateLimiting = Config.rateLimiting

  beforeEach(() => {
    // Spy on the logger so nothing hits the log but calls can still be checked
    vi.spyOn(Logger, 'error').mockResolvedValue(undefined)
  })

  afterEach(() => {
    // Undo whatever the test changed so the next one starts clean
    Config.rateLimiting = savedRateLimiting
    vi.restoreAllMocks()
  })

  it('ignores bots', async () => {
    // The only use case the handler gets and it should not be touched for a bot
    const botUpdate = useCase()

    await new GuildMemberUpdateHandler([botUpdate]).process(member(), member([], { bot: true }))

    expect(botUpdate.handle).not.toHaveBeenCalled()
  })

  it('tells each use case which roles were added and removed', async () => {
    // Two of them to make sure every use case gets the same diff
    const useCases = [useCase(), useCase()]

    await new GuildMemberUpdateHandler(useCases).process(
      member(['old', 'kept']),
      member(['new', 'kept']),
    )

    for (const { handle } of useCases) {
      // Third argument of the first call is where the diff lives
      const context = handle.mock.calls[0][2]
      expect([...context.addedRoles.keys()]).toEqual(['new'])
      expect([...context.removedRoles.keys()]).toEqual(['old'])
    }
  })

  it('keeps running the other use cases when one throws', async () => {
    // The error the first use case blows up with
    const error = new Error('૮(˶╥︿╥)ა test failed')
    // Throws once then goes back to normal
    const failing = useCase()
    failing.handle.mockRejectedValueOnce(error)
    // Needs to still run even though the one before it failed
    const after = useCase()

    await new GuildMemberUpdateHandler([failing, after]).process(member(), member())

    expect(after.handle).toHaveBeenCalledOnce()
    // Message first error second since getting them the wrong way round is half of #146
    expect(Logger.error).toHaveBeenCalledWith(
      'Member update use case threw; other use cases still run',
      error,
    )
  })

  it('limits each member by the memberUpdates setting, not the button one', async () => {
    // Make buttons generous and memberUpdates tight so how many get through shows which setting the handler read
    Config.rateLimiting = {
      ...savedRateLimiting,
      buttons: { amount: 100, interval: 30 },
      memberUpdates: { amount: 1, interval: 30 },
    }
    // Counts how many updates made it past the limit
    const tracked = useCase()
    const handler = new GuildMemberUpdateHandler([tracked])

    await handler.process(member(), member())
    await handler.process(member(), member())
    await handler.process(member(), member([], { id: 'member-2' }))

    // One for the first member since the second is over the limit and one for the other member
    expect(tracked.handle).toHaveBeenCalledTimes(2)
  })
})
