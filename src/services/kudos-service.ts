import { and, asc, count, desc, eq, gt, gte } from 'drizzle-orm'
import { DateTime } from 'luxon'

import {
  KudosGiveCooldownDays,
  KudosLeaderboardTimeZone,
  KudosNotificationWindowMs,
} from '../constants/index.js'
import { type Database } from '../database/index.js'
import { kudosNotification, kudosTransaction } from '../database/schema.js'
import { Logger } from './logger.js'

export type KudosLeaderboardPeriod = 'weekly' | 'monthly'

export interface KudosLeaderboardEntry {
  receiverDiscordId: string
  total: number
}

export interface KudosNotificationEntry {
  giverDiscordId: string
  reason: string | null
}

export interface KudosNotificationBatch {
  messageId?: string
  windowStartedAt: Date
  entries: KudosNotificationEntry[]
}

export type GiveKudosResult =
  | { status: 'given'; total: number; givenAt: Date }
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

    const givenAt = new Date()
    const cooldownStart = new Date(givenAt.getTime() - KudosGiveCooldownDays * 24 * 60 * 60 * 1000)

    // The cooldown check and the insert run inside a single synchronous
    // better-sqlite3 transaction (no `await` in the callback) so a second
    // concurrent give for the same pair can't be interleaved between the
    // SELECT and the INSERT - the outcome is decided atomically.
    const outcome = this.db.transaction((tx) => {
      const lastGive = tx
        .select({ createdAt: kudosTransaction.createdAt })
        .from(kudosTransaction)
        .where(
          and(
            eq(kudosTransaction.guildId, guildId),
            eq(kudosTransaction.giverDiscordId, giverDiscordId),
            eq(kudosTransaction.receiverDiscordId, receiverDiscordId),
            gte(kudosTransaction.createdAt, cooldownStart),
          ),
        )
        .orderBy(desc(kudosTransaction.createdAt))
        .get()

      if (lastGive) {
        const retryAt = new Date(
          lastGive.createdAt.getTime() + KudosGiveCooldownDays * 24 * 60 * 60 * 1000,
        )
        return { status: 'cooldown' as const, retryAt }
      }

      tx.insert(kudosTransaction)
        .values({ guildId, giverDiscordId, receiverDiscordId, reason, createdAt: givenAt })
        .run()

      return { status: 'given' as const }
    })

    if (outcome.status === 'cooldown') {
      return outcome
    }

    const total = await this.getTotal(guildId, receiverDiscordId)
    Logger.info(`${giverDiscordId} gave kudos to ${receiverDiscordId} in guild ${guildId}`)
    return { status: 'given', total, givenAt }
  }

  /** All-time kudos total for a receiver within a guild. */
  public async getTotal(guildId: string, receiverDiscordId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(kudosTransaction)
      .where(
        and(
          eq(kudosTransaction.guildId, guildId),
          eq(kudosTransaction.receiverDiscordId, receiverDiscordId),
        ),
      )

    return row?.total ?? 0
  }

  /**
   * Returns the receiver's active one-hour DM batch, including the give that
   * just completed. A missing message ID means a new DM window must be opened.
   */
  public async getNotificationBatch(
    guildId: string,
    receiverDiscordId: string,
    givenAt: Date,
  ): Promise<KudosNotificationBatch> {
    const activeAfter = new Date(givenAt.getTime() - KudosNotificationWindowMs)
    const notification = await this.db.query.kudosNotification.findFirst({
      where: and(
        eq(kudosNotification.guildId, guildId),
        eq(kudosNotification.receiverDiscordId, receiverDiscordId),
        gt(kudosNotification.windowStartedAt, activeAfter),
      ),
    })
    const windowStartedAt = notification?.windowStartedAt ?? givenAt

    const entries = await this.db
      .select({
        giverDiscordId: kudosTransaction.giverDiscordId,
        reason: kudosTransaction.reason,
      })
      .from(kudosTransaction)
      .where(
        and(
          eq(kudosTransaction.guildId, guildId),
          eq(kudosTransaction.receiverDiscordId, receiverDiscordId),
          gte(kudosTransaction.createdAt, windowStartedAt),
        ),
      )
      .orderBy(asc(kudosTransaction.createdAt), asc(kudosTransaction.id))

    return { messageId: notification?.messageId, windowStartedAt, entries }
  }

  /** Records the message backing a receiver's current one-hour DM batch. */
  public async saveNotification(
    guildId: string,
    receiverDiscordId: string,
    messageId: string,
    windowStartedAt: Date,
  ): Promise<void> {
    await this.db
      .insert(kudosNotification)
      .values({ guildId, receiverDiscordId, messageId, windowStartedAt })
      .onConflictDoUpdate({
        target: [kudosNotification.guildId, kudosNotification.receiverDiscordId],
        set: { messageId, windowStartedAt },
      })
  }

  /** Top receivers in a guild for the current local calendar week or month. */
  public async getLeaderboard(
    guildId: string,
    period: KudosLeaderboardPeriod,
    limit: number = 10,
  ): Promise<KudosLeaderboardEntry[]> {
    const windowStart = this.getLeaderboardWindowStart(period)

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

  private getLeaderboardWindowStart(period: KudosLeaderboardPeriod): Date {
    const now = DateTime.now().setZone(KudosLeaderboardTimeZone)
    if (period === 'monthly') {
      return now.startOf('month').toUTC().toJSDate()
    }

    const daysSinceSunday = now.weekday % 7
    return now.startOf('day').minus({ days: daysSinceSunday }).toUTC().toJSDate()
  }
}
