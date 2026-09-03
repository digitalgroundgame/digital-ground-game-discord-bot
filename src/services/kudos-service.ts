import { and, count, desc, eq, gte } from 'drizzle-orm'

import { KudosGiveCooldownDays } from '../constants/index.js'
import { type Database } from '../database/index.js'
import { kudosTransaction } from '../database/schema.js'
import { Logger } from './logger.js'

export type KudosLeaderboardPeriod = 'weekly' | 'monthly'

export interface KudosLeaderboardEntry {
  receiverDiscordId: string
  total: number
}

export type GiveKudosResult =
  | { status: 'given'; total: number }
  | { status: 'self' }
  | { status: 'cooldown'; retryAt: Date }

/**
 * Tracks kudos given between members as an append-only ledger. Totals and
 * leaderboards are derived by querying the ledger rather than kept in a
 * separately-maintained running total, so they can never drift out of sync.
 */
export class KudosService {
  constructor(private readonly db: Database) {}

  /**
   * Records a kudos give, unless the giver is targeting themselves or is
   * still within the cooldown window for this receiver.
   */
  public async giveKudos(
    guildId: string,
    giverDiscordId: string,
    receiverDiscordId: string,
    reason?: string,
  ): Promise<GiveKudosResult> {
    if (giverDiscordId === receiverDiscordId) {
      return { status: 'self' }
    }

    const cooldownStart = this.daysAgo(KudosGiveCooldownDays)
    const lastGive = await this.db.query.kudosTransaction.findFirst({
      where: and(
        eq(kudosTransaction.guildId, guildId),
        eq(kudosTransaction.giverDiscordId, giverDiscordId),
        eq(kudosTransaction.receiverDiscordId, receiverDiscordId),
        gte(kudosTransaction.createdAt, cooldownStart),
      ),
      orderBy: desc(kudosTransaction.createdAt),
    })

    if (lastGive) {
      const retryAt = new Date(lastGive.createdAt)
      retryAt.setDate(retryAt.getDate() + KudosGiveCooldownDays)
      return { status: 'cooldown', retryAt }
    }

    await this.db.insert(kudosTransaction).values({
      guildId,
      giverDiscordId,
      receiverDiscordId,
      reason,
    })

    const total = await this.getTotal(receiverDiscordId)
    Logger.info(`${giverDiscordId} gave kudos to ${receiverDiscordId} in guild ${guildId}`)
    return { status: 'given', total }
  }

  /** All-time kudos total for a receiver. */
  public async getTotal(receiverDiscordId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(kudosTransaction)
      .where(eq(kudosTransaction.receiverDiscordId, receiverDiscordId))

    return row?.total ?? 0
  }

  /** Top receivers in a guild for the current weekly or monthly window. */
  public async getLeaderboard(
    guildId: string,
    period: KudosLeaderboardPeriod,
    limit: number = 10,
  ): Promise<KudosLeaderboardEntry[]> {
    const windowStart = period === 'weekly' ? this.daysAgo(7) : this.daysAgo(30)

    return this.db
      .select({ receiverDiscordId: kudosTransaction.receiverDiscordId, total: count() })
      .from(kudosTransaction)
      .where(
        and(eq(kudosTransaction.guildId, guildId), gte(kudosTransaction.createdAt, windowStart)),
      )
      .groupBy(kudosTransaction.receiverDiscordId)
      .orderBy(desc(count()))
      .limit(limit)
  }

  private daysAgo(days: number): Date {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date
  }
}
