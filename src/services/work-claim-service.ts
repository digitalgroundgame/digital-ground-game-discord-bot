import { and, eq } from 'drizzle-orm'

import { type DatabaseTransaction, insertPointsAward, type PointsAward } from './kudos-service.js'
import { Logger } from './logger.js'
import { type Database } from '../database/index.js'
import {
  type IssueClaim,
  issueClaim,
  type ReviewRequest,
  reviewRequest,
  user,
} from '../database/schema.js'

/** What the caller needs to record when a claim is accepted. */
export interface RecordClaimInput {
  guildId: string
  discordUserId: string
  githubLogin: string
  repo: string
  issueNumber: number
  wildcard: boolean
}

/** What the caller needs to record when a review request is accepted. */
export interface RecordReviewRequestInput {
  guildId: string
  discordUserId: string
  githubLogin: string
  repo: string
  pullNumber: number
}

/** The points to pay when settling as completed. Everything but the guild and receiver, which come from the claim. */
export type SettleAward = Omit<PointsAward, 'guildId' | 'receiverDiscordId'>

/**
 * Ensure the `user` row exists, the same way `UserService.linkAccount` does,
 * since a member may claim work before anything else has written them a row.
 */
function ensureUser(tx: DatabaseTransaction, discordUserId: string, now: Date): void {
  tx.insert(user)
    .values({ discordUserId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: user.discordUserId, set: { updatedAt: now } })
    .run()
}

/**
 * Records which Discord member took on which GitHub issue or review through
 * `/find-work`, and settles those records once the payout job sees how they
 * ended.
 *
 * These tables, not GitHub, are what make a Democracy Points payout
 * attributable. The payout job pays only a claimer who is still assigned when
 * the issue closes, so someone who took the work over — and therefore
 * displaced the original assignee — cannot be paid for it, and the original
 * claimer cannot be paid for work they dropped.
 */
export class WorkClaimService {
  constructor(private readonly db: Database) {}

  /** Record an accepted issue claim. */
  public async recordClaim(input: RecordClaimInput): Promise<void> {
    const now = new Date()
    this.db.transaction((tx) => {
      ensureUser(tx, input.discordUserId, now)
      tx.insert(issueClaim)
        .values({
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          githubLogin: input.githubLogin,
          repo: input.repo,
          issueNumber: input.issueNumber,
          wildcard: input.wildcard,
          state: 'claimed',
          claimedAt: now,
        })
        .run()
    })
    Logger.info(
      `Work claim: ${input.discordUserId} (${input.githubLogin}) claimed ${input.repo}#${input.issueNumber}${input.wildcard ? ' [wildcard]' : ''}`,
    )
  }

  /** The live claim on an issue, if someone already holds one. */
  public async findLiveClaim(repo: string, issueNumber: number): Promise<IssueClaim | undefined> {
    return this.db.query.issueClaim.findFirst({
      where: and(
        eq(issueClaim.repo, repo),
        eq(issueClaim.issueNumber, issueNumber),
        eq(issueClaim.state, 'claimed'),
      ),
    })
  }

  /** Every unresolved issue claim, oldest first — the payout job's read path. */
  public async listLiveClaims(): Promise<IssueClaim[]> {
    return this.db.query.issueClaim.findMany({
      where: eq(issueClaim.state, 'claimed'),
      orderBy: issueClaim.claimedAt,
    })
  }

  /**
   * Settle a live claim, paying `award` to the claimer when it completed.
   *
   * The state change and the award are one transaction, and the update only
   * matches a claim still marked `claimed`, so a claim can be paid at most
   * once however many times this runs. Returns whether it settled anything.
   */
  public async settleClaim(
    claim: IssueClaim,
    outcome: 'completed' | 'expired',
    award?: SettleAward,
  ): Promise<boolean> {
    return this.db.transaction((tx) => {
      const result = tx
        .update(issueClaim)
        .set({ state: outcome, resolvedAt: new Date() })
        .where(and(eq(issueClaim.id, claim.id), eq(issueClaim.state, 'claimed')))
        .run()
      if (result.changes === 0) return false
      if (outcome === 'completed' && award) {
        insertPointsAward(tx, {
          ...award,
          guildId: claim.guildId,
          receiverDiscordId: claim.discordUserId,
        })
      }
      return true
    })
  }

  /** Record an accepted review request, unless the member already holds a live one on it. */
  public async recordReviewRequest(input: RecordReviewRequestInput): Promise<void> {
    const now = new Date()
    this.db.transaction((tx) => {
      ensureUser(tx, input.discordUserId, now)
      tx.insert(reviewRequest)
        .values({
          guildId: input.guildId,
          discordUserId: input.discordUserId,
          githubLogin: input.githubLogin,
          repo: input.repo,
          pullNumber: input.pullNumber,
          state: 'requested',
          requestedAt: now,
        })
        .onConflictDoNothing()
        .run()
    })
    Logger.info(
      `Work claim: ${input.discordUserId} (${input.githubLogin}) took review of ${input.repo}#${input.pullNumber}`,
    )
  }

  /** Every unresolved review request, oldest first — the payout job's read path. */
  public async listLiveReviewRequests(): Promise<ReviewRequest[]> {
    return this.db.query.reviewRequest.findMany({
      where: eq(reviewRequest.state, 'requested'),
      orderBy: reviewRequest.requestedAt,
    })
  }

  /** Settle a live review request. Same once-only guarantee as `settleClaim`. */
  public async settleReviewRequest(
    request: ReviewRequest,
    outcome: 'completed' | 'expired',
    award?: SettleAward,
  ): Promise<boolean> {
    return this.db.transaction((tx) => {
      const result = tx
        .update(reviewRequest)
        .set({ state: outcome, resolvedAt: new Date() })
        .where(and(eq(reviewRequest.id, request.id), eq(reviewRequest.state, 'requested')))
        .run()
      if (result.changes === 0) return false
      if (outcome === 'completed' && award) {
        insertPointsAward(tx, {
          ...award,
          guildId: request.guildId,
          receiverDiscordId: request.discordUserId,
        })
      }
      return true
    })
  }
}
