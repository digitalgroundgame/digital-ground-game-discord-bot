import { beforeEach, describe, expect, it } from 'vitest'

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

  it('records a give and returns the receiver total', async () => {
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1', 'great work')

    expect(result).toEqual({ status: 'given', total: 1 })
    expect(await service.getTotal('receiver-1')).toBe(1)
  })

  it('accumulates totals across multiple givers', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    await service.giveKudos(GUILD_ID, 'giver-2', 'receiver-1')

    expect(await service.getTotal('receiver-1')).toBe(2)
  })

  it('rejects a self-give without recording it', async () => {
    const result = await service.giveKudos(GUILD_ID, 'user-1', 'user-1')

    expect(result).toEqual({ status: 'self' })
    expect(await service.getTotal('user-1')).toBe(0)
  })

  it('rejects a repeat give within the cooldown window', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')

    expect(result.status).toBe('cooldown')
    expect(await service.getTotal('receiver-1')).toBe(1)
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

  it('does not let a cooldown against one receiver block giving to another', async () => {
    await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-1')
    const result = await service.giveKudos(GUILD_ID, 'giver-1', 'receiver-2')

    expect(result).toEqual({ status: 'given', total: 1 })
  })

  it('ranks the weekly leaderboard by total within the window, excluding older gives', async () => {
    await db.insert(kudosTransaction).values([
      { guildId: GUILD_ID, giverDiscordId: 'g1', receiverDiscordId: 'receiver-1' },
      { guildId: GUILD_ID, giverDiscordId: 'g2', receiverDiscordId: 'receiver-1' },
      { guildId: GUILD_ID, giverDiscordId: 'g3', receiverDiscordId: 'receiver-2' },
      {
        guildId: GUILD_ID,
        giverDiscordId: 'g4',
        receiverDiscordId: 'receiver-3',
        createdAt: daysAgo(10),
      },
    ])

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'weekly')

    expect(leaderboard).toEqual([
      { receiverDiscordId: 'receiver-1', total: 2 },
      { receiverDiscordId: 'receiver-2', total: 1 },
    ])
  })

  it('includes gives from earlier in the month on the monthly leaderboard', async () => {
    await db.insert(kudosTransaction).values({
      guildId: GUILD_ID,
      giverDiscordId: 'g1',
      receiverDiscordId: 'receiver-3',
      createdAt: daysAgo(10),
    })

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'monthly')

    expect(leaderboard).toEqual([{ receiverDiscordId: 'receiver-3', total: 1 }])
  })

  it('scopes the leaderboard to the given guild', async () => {
    await db.insert(kudosTransaction).values([
      { guildId: GUILD_ID, giverDiscordId: 'g1', receiverDiscordId: 'receiver-1' },
      { guildId: 'other-guild', giverDiscordId: 'g2', receiverDiscordId: 'receiver-2' },
    ])

    const leaderboard = await service.getLeaderboard(GUILD_ID, 'weekly')

    expect(leaderboard).toEqual([{ receiverDiscordId: 'receiver-1', total: 1 }])
  })
})
