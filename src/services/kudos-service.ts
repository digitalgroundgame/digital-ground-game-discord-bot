import { and, asc, count, desc, eq, gte, max } from 'drizzle-orm'
import { DateTime } from 'luxon'

import { KudosGiveCooldownDays, KudosLeaderboardTimeZone } from '../constants/index.js'
import { type Database } from '../database/index.js'
import { kudosTransaction } from '../database/schema.js'
import { Logger } from './logger.js'

export type KudosLeaderboardPeriod = 'weekly' | 'monthly'

export interface KudosLeaderboardEntry {
  receiverDiscordId: string
  total: number
}

/** The message a kudos was given for, when given by reaction. */
export interface KudosSource {
  channelId: string
  messageId: string
}

export type GiveKudosResult =
  | { status: 'given'; total: number }
  | { status: 'self' }
  | { status: 'duplicate' }
  | { status: 'cooldown'; retryAt: Date }

/** A transaction on the app database, as handed to `db.transaction`'s callback. */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Points the bot pays out itself, rather than one member giving another. */
export interface PointsAward {
  guildId: string
  /** The bot's own user id, so the ledger shows the award wasn't a member's give. */
  giverDiscordId: string
  receiverDiscordId: string
  reason: string
  points: number
}

/**
 * Write a system award as `points` ledger rows — totals and leaderboards
 * count rows, so this is how an award worth more than one point is recorded.
 *
 * Skips the self, duplicate and cooldown checks in `giveKudos`: those police
 * members giving each other points, and a payout is instead made idempotent
 * by the claim it settles, which the caller must update in the same
 * transaction.
 */
export function insertPointsAward(tx: DatabaseTransaction, award: PointsAward): void {
  if (award.points <= 0) return
  const createdAt = new Date()
  tx.insert(kudosTransaction)
    .values(
      Array.from({ length: award.points }, () => ({
        guildId: award.guildId,
        giverDiscordId: award.giverDiscordId,
        receiverDiscordId: award.receiverDiscordId,
        reason: award.reason,
        createdAt,
      })),
    )
    .run()
}

/**
 * Tracks kudos given between members as an append-only ledger. Totals and
 * leaderboards are derived by querying the ledger rather than kept in a
 * separately-maintained running total, so they can never drift out of sync.
 */
export class KudosService {
  constructor(private readonly db: Database) {}

  /**
   * Records a kudos give, unless the giver is targeting themselves, already
   * gave kudos for the same source message, or is still within the cooldown
   * window for this receiver.
   */
  public async giveKudos(
    guildId: string,
    giverDiscordId: string,
    receiverDiscordId: string,
    reason?: string,
    source?: KudosSource,
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
      // Checked before the cooldown so re-adding a reaction on a message that
      // already earned kudos is recognized as a no-op, not a new attempt.
      if (source) {
        const sameMessage = tx
          .select({ id: kudosTransaction.id })
          .from(kudosTransaction)
          .where(
            and(
              eq(kudosTransaction.guildId, guildId),
              eq(kudosTransaction.messageId, source.messageId),
              eq(kudosTransaction.giverDiscordId, giverDiscordId),
            ),
          )
          .get()
        if (sameMessage) {
          return { status: 'duplicate' as const }
        }
      }

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
        .values({
          guildId,
          giverDiscordId,
          receiverDiscordId,
          reason,
          channelId: source?.channelId,
          messageId: source?.messageId,
          createdAt: givenAt,
        })
        .run()

      return { status: 'given' as const }
    })

    if (outcome.status !== 'given') {
      return outcome
    }

    const total = await this.getTotal(guildId, receiverDiscordId)
    Logger.info(`${giverDiscordId} gave kudos to ${receiverDiscordId} in guild ${guildId}`)
    return { status: 'given', total }
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
      .orderBy(
        desc(count()),
        asc(max(kudosTransaction.createdAt)),
        asc(kudosTransaction.receiverDiscordId),
      )
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
