import { beforeEach, describe, expect, it } from 'vitest'

import { type IssueClaim, kudosTransaction } from '../../src/database/schema.js'
import { UserService } from '../../src/services/user-service.js'
import { WorkClaimService } from '../../src/services/work-claim-service.js'
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js'

const GUILD_ID = 'guild-1'
const BOT_ID = 'bot-1'

describe('WorkClaimService', () => {
  let db: TestDatabase
  let service: WorkClaimService

  beforeEach(() => {
    db = createTestDatabase()
    service = new WorkClaimService(db)
  })

  async function liveClaim(): Promise<IssueClaim | undefined> {
    const live = await service.listLiveClaims()
    return live.find((c) => c.repo === 'org/site' && c.issueNumber === 7)
  }

  async function claim(): Promise<void> {
    await service.recordClaim({
      guildId: GUILD_ID,
      discordUserId: 'member-1',
      githubLogin: 'alice',
      repo: 'org/site',
      issueNumber: 7,
      wildcard: true,
    })
  }

  it('records a live claim', async () => {
    await claim()
    const live = await liveClaim()
    expect(live).toMatchObject({ guildId: GUILD_ID, githubLogin: 'alice', wildcard: true })
  })

  // The login is copied onto the claim, so relinking can't hand someone else's
  // payout to the new account.
  it('keeps the assigned login on a claim when the member relinks GitHub', async () => {
    const users = new UserService(db)
    await users.linkAccount('member-1', 'github', { externalId: 'alice' })
    await claim()
    await users.linkAccount('member-1', 'github', { externalId: 'alice-new' })

    expect((await users.findLinkedAccount('member-1', 'github'))?.externalId).toBe('alice-new')
    expect((await liveClaim())?.githubLogin).toBe('alice')
  })

  it('pays a completed claim as one ledger row per point, from the bot', async () => {
    await claim()
    const [live] = await service.listLiveClaims()
    if (!live) throw new Error('expected a live claim')

    const settled = await service.settleClaim(live, 'completed', {
      giverDiscordId: BOT_ID,
      reason: 'Completed org/site#7',
      points: 2,
    })

    expect(settled).toBe(true)
    const rows = db.select().from(kudosTransaction).all()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      guildId: GUILD_ID,
      giverDiscordId: BOT_ID,
      receiverDiscordId: 'member-1',
      reason: 'Completed org/site#7',
    })
    expect(await service.listLiveClaims()).toEqual([])
  })

  it('pays a claim at most once', async () => {
    await claim()
    const [live] = await service.listLiveClaims()
    if (!live) throw new Error('expected a live claim')
    const award = { giverDiscordId: BOT_ID, reason: 'r', points: 1 }

    expect(await service.settleClaim(live, 'completed', award)).toBe(true)
    expect(await service.settleClaim(live, 'completed', award)).toBe(false)
    expect(db.select().from(kudosTransaction).all()).toHaveLength(1)
  })

  it('pays nothing for an expired claim', async () => {
    await claim()
    const [live] = await service.listLiveClaims()
    if (!live) throw new Error('expected a live claim')

    expect(await service.settleClaim(live, 'expired')).toBe(true)
    expect(db.select().from(kudosTransaction).all()).toEqual([])
    expect(await liveClaim()).toBeUndefined()
  })

  it('lets the issue be claimed again after an expiry', async () => {
    await claim()
    const [live] = await service.listLiveClaims()
    if (!live) throw new Error('expected a live claim')
    await service.settleClaim(live, 'expired')

    await claim()
    expect(await service.listLiveClaims()).toHaveLength(1)
  })

  it('settles the same issue more than once across re-claims', async () => {
    for (let round = 0; round < 3; round++) {
      await claim()
      const [live] = await service.listLiveClaims()
      if (!live) throw new Error('expected a live claim')
      expect(await service.settleClaim(live, 'expired')).toBe(true)
    }
    await claim()
    const [live] = await service.listLiveClaims()
    if (!live) throw new Error('expected a live claim')
    const award = { giverDiscordId: BOT_ID, reason: 'r', points: 1 }
    expect(await service.settleClaim(live, 'completed', award)).toBe(true)
    expect(await service.listLiveClaims()).toHaveLength(0)
  })

  it('refuses a second live claim on the same issue', async () => {
    await claim()
    const second = await service.recordClaim({
      guildId: GUILD_ID,
      discordUserId: 'member-2',
      githubLogin: 'bob',
      repo: 'org/site',
      issueNumber: 7,
      wildcard: false,
    })
    expect(second).toBeUndefined()
    expect((await liveClaim())?.githubLogin).toBe('alice')
  })

  it('frees the issue when a claim is released', async () => {
    await claim()
    const live = await liveClaim()
    if (!live) throw new Error('expected a live claim')
    await service.releaseClaim(live.id)
    expect(await liveClaim()).toBeUndefined()
    await claim()
    expect(await service.listLiveClaims()).toHaveLength(1)
  })

  it('settles repeat review requests from the same member', async () => {
    const input = {
      guildId: GUILD_ID,
      discordUserId: 'member-1',
      githubLogin: 'alice',
      repo: 'org/site',
      pullNumber: 9,
    }
    for (let round = 0; round < 2; round++) {
      await service.recordReviewRequest(input)
      const [live] = await service.listLiveReviewRequests()
      if (!live) throw new Error('expected a live request')
      expect(await service.settleReviewRequest(live, 'expired')).toBe(true)
    }
    expect(await service.listLiveReviewRequests()).toHaveLength(0)
  })

  it('ignores a second live review request from the same member', async () => {
    const input = {
      guildId: GUILD_ID,
      discordUserId: 'member-1',
      githubLogin: 'alice',
      repo: 'org/site',
      pullNumber: 9,
    }
    await service.recordReviewRequest(input)
    await service.recordReviewRequest(input)
    await service.recordReviewRequest({ ...input, discordUserId: 'member-2', githubLogin: 'bob' })

    expect(await service.listLiveReviewRequests()).toHaveLength(2)
  })

  it('pays a completed review request once', async () => {
    await service.recordReviewRequest({
      guildId: GUILD_ID,
      discordUserId: 'member-1',
      githubLogin: 'alice',
      repo: 'org/site',
      pullNumber: 9,
    })
    const [live] = await service.listLiveReviewRequests()
    if (!live) throw new Error('expected a live request')
    const award = { giverDiscordId: BOT_ID, reason: 'r', points: 1 }

    expect(await service.settleReviewRequest(live, 'completed', award)).toBe(true)
    expect(await service.settleReviewRequest(live, 'completed', award)).toBe(false)
    expect(db.select().from(kudosTransaction).all()).toHaveLength(1)
  })
})
