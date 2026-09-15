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

    expect(result).toEqual({ status: 'given', total: 1, givenAt: expect.any(Date) })
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

    expect(result).toEqual({ status: 'given', total: 2, givenAt: expect.any(Date) })
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

    expect(result).toEqual({ status: 'given', total: 1, givenAt: expect.any(Date) })
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

  it('collects gives into a persisted one-hour notification batch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))
    const first = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', 'first reason')
    if (first.status !== 'given') {
      throw new Error('Expected the first kudos to be given')
    }
    await service.saveNotification(GUILD_ID, 'receiver-1', 'message-1', first.givenAt)

    vi.setSystemTime(new Date('2026-09-16T16:30:00Z'))
    const second = await service.giveKudos(GUILD_ID, 'giver-2', 'receiver-1')
    if (second.status !== 'given') {
      throw new Error('Expected the second kudos to be given')
    }

    const batch = await service.getNotificationBatch(GUILD_ID, 'receiver-1', second.givenAt)

    expect(batch).toEqual({
      messageId: 'message-1',
      windowStartedAt: first.givenAt,
      entries: [
        { giverDiscordId: 'giver-1', reason: 'first reason' },
        { giverDiscordId: 'giver-2', reason: null },
      ],
    })
  })

  it('opens a new notification batch once the previous hour expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))
    const first = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    if (first.status !== 'given') {
      throw new Error('Expected the first kudos to be given')
    }
    await service.saveNotification(GUILD_ID, 'receiver-1', 'message-1', first.givenAt)

    vi.setSystemTime(new Date('2026-09-16T17:00:00Z'))
    const second = await service.giveKudos(GUILD_ID, 'giver-2', 'receiver-1')
    if (second.status !== 'given') {
      throw new Error('Expected the second kudos to be given')
    }

    const batch = await service.getNotificationBatch(GUILD_ID, 'receiver-1', second.givenAt)

    expect(batch).toEqual({
      messageId: undefined,
      windowStartedAt: second.givenAt,
      entries: [{ giverDiscordId: 'giver-2', reason: null }],
    })
  })
})
