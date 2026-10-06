import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { kudosTransaction } from '../../src/database/schema.js'
import { KudosService } from '../../src/services/kudos-service.js'
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js'

const GUILD_ID = 'guild-1'

function daysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

describe('KudosService', () => {
  let db: TestDatabase
  let service: KudosService

  beforeEach(() => {
    db = createTestDatabase()
    service = new KudosService(db)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records a give and returns the receiver total', async () => {
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', 'great work')

    expect(result).toEqual({ status: 'given', total: 1 })
    expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
  })

  it('accumulates totals across multiple givers', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    await service.giveKudos(GUILD_ID, 'giver-2', 'receiver-1')

    expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(2)
  })

  it('rejects a self-give without recording it', async () => {
    const result = await service.giveKudos(GUILD_ID, 'user-1', 'user-1')

    expect(result).toEqual({ status: 'self' })
    expect(await service.getTotal(GUILD_ID, 'user-1')).toBe(0)
  })

  it('rejects a repeat give within the cooldown window', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')

    expect(result.status).toBe('cooldown')
    expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
  })

  it('allows a repeat give once the cooldown window has passed', async () => {
    await db.insert(kudosTransaction).values({
      guildId: GUILD_ID,
      giverDiscordId: 'giver-1',
      receiverDiscordId: 'receiver-1',
      createdAt: daysAgo(8),
    })

    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')

    expect(result).toEqual({ status: 'given', total: 2 })
  })

  it('only records one give when two requests for the same pair race', async () => {
    const [first, second] = await Promise.all([
      service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1'),
      service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1'),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['cooldown', 'given'])
    expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
  })

  it('does not let a cooldown against one receiver block giving to another', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-2')

    expect(result).toEqual({ status: 'given', total: 1 })
  })

  it('scopes totals to the given guild', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    await service.giveKudos('other-guild', 'giver-2', 'receiver-1')

    expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
  })

  it('starts the weekly leaderboard Sunday at local midnight (DST-aware)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))

    // 2026-09-13 is during Eastern Daylight Time (UTC-4), so local midnight
    // is 04:00Z, not the fixed 05:00Z a plain UTC-5 offset would use.
    await db.insert(kudosTransaction).values([
      {
        guildId: GUILD_ID,
        giverDiscordId: 'before-boundary',
        receiverDiscordId: 'excluded',
        createdAt: new Date('2026-09-13T03:59:59Z'),
      },
      {
        guildId: GUILD_ID,
        giverDiscordId: 'at-boundary',
        receiverDiscordId: 'included',
        createdAt: new Date('2026-09-13T04:00:00Z'),
      },
    ])

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'weekly')

    expect(leaderboard).toEqual([{ receiverDiscordId: 'included', total: 1 }])
  })

  it('starts the monthly leaderboard on the first at local midnight (DST-aware)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))

    // 2026-09-01 is during Eastern Daylight Time (UTC-4), so local midnight
    // is 04:00Z, not the fixed 05:00Z a plain UTC-5 offset would use.
    await db.insert(kudosTransaction).values([
      {
        guildId: GUILD_ID,
        giverDiscordId: 'before-boundary',
        receiverDiscordId: 'excluded',
        createdAt: new Date('2026-09-01T03:59:59Z'),
      },
      {
        guildId: GUILD_ID,
        giverDiscordId: 'at-boundary',
        receiverDiscordId: 'included',
        createdAt: new Date('2026-09-01T04:00:00Z'),
      },
    ])

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'monthly')

    expect(leaderboard).toEqual([{ receiverDiscordId: 'included', total: 1 }])
  })

  it('scopes the leaderboard to the given guild', async () => {
    await db.insert(kudosTransaction).values([
      { guildId: GUILD_ID, giverDiscordId: 'g1', receiverDiscordId: 'receiver-1' },
      { guildId: 'other-guild', giverDiscordId: 'g2', receiverDiscordId: 'receiver-2' },
    ])

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'weekly')

    expect(leaderboard).toEqual([{ receiverDiscordId: 'receiver-1', total: 1 }])
  })

  describe('message-sourced gives', () => {
    const source = { channelId: 'channel-1', messageId: 'message-1' }

    it('records the source message on the ledger row', async () => {
      await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)

      const rows = await db
        .select({
          channelId: kudosTransaction.channelId,
          messageId: kudosTransaction.messageId,
        })
        .from(kudosTransaction)

      expect(rows).toEqual([{ channelId: 'channel-1', messageId: 'message-1' }])
    })

    it('reports a duplicate, not a cooldown, when the same message is given kudos again', async () => {
      await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)
      const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)

      expect(result).toEqual({ status: 'duplicate' })
      expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
    })

    it('still reports a duplicate for the same message after the cooldown has passed', async () => {
      await db.insert(kudosTransaction).values({
        guildId: GUILD_ID,
        giverDiscordId: 'giver-1',
        receiverDiscordId: 'receiver-1',
        channelId: source.channelId,
        messageId: source.messageId,
        createdAt: daysAgo(8),
      })

      const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)

      expect(result).toEqual({ status: 'duplicate' })
      expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
    })

    it('applies the cooldown to a different message by the same receiver', async () => {
      await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)
      const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, {
        channelId: 'channel-1',
        messageId: 'message-2',
      })

      expect(result.status).toBe('cooldown')
      expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
    })

    it('shares the cooldown between command gives and message gives', async () => {
      await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', 'from the command')
      const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)

      expect(result.status).toBe('cooldown')
      expect(await service.getTotal(GUILD_ID, 'receiver-1')).toBe(1)
    })

    it('lets another giver give kudos to the same message', async () => {
      await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', undefined, source)
      const result = await service.giveKudos(GUILD_ID, 'giver-2', 'receiver-1', undefined, source)

      expect(result).toEqual({ status: 'given', total: 2 })
    })
  })
})
