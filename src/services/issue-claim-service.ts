import { and, eq } from 'drizzle-orm'

import { Logger } from './logger.js'
import { type Database } from '../database/index.js'
import { type IssueClaim, issueClaim, user } from '../database/schema.js'

/** What the caller needs to record when a claim is accepted. */
export interface RecordClaimInput {
  discordUserId: string
  githubLogin: string
  repo: string
  issueNumber: number
  wildcard: boolean
}

/**
 * Records which Discord member claimed which GitHub issue through
 * `/give-issue`.
 *
 * This table, not GitHub, is what makes a kudos payout attributable. The
 * payout job walks live claims and pays only a claimer who is still assigned
 * when the issue closes, so someone who took the work over — and therefore
 * displaced the original assignee — cannot be paid for it, and the original
 * claimer cannot be paid for work they dropped.
 */
export class IssueClaimService {
  constructor(private readonly db: Database) {}

  /**
   * Record an accepted claim. Ensures the `user` row exists first, the same
   * way `UserService.linkAccount` does, since a member may claim an issue
   * before anything else has written them a row.
   */
  public async recordClaim(input: RecordClaimInput): Promise<void> {
    const now = new Date()
    this.db.transaction((tx) => {
      tx.insert(user)
        .values({ discordUserId: input.discordUserId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: user.discordUserId, set: { updatedAt: now } })
        .run()

      tx.insert(issueClaim)
        .values({
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
      `Issue claim: ${input.discordUserId} (${input.githubLogin}) claimed ${input.repo}#${input.issueNumber}${input.wildcard ? ' [wildcard]' : ''}`,
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

  /** Every unresolved claim, oldest first — the payout job's read path. */
  public async listLiveClaims(): Promise<IssueClaim[]> {
    return this.db.query.issueClaim.findMany({
      where: eq(issueClaim.state, 'claimed'),
      orderBy: issueClaim.claimedAt,
    })
  }

  /** Settle a claim once the payout job has decided what happened to it. */
  public async resolveClaim(id: number, state: 'completed' | 'expired'): Promise<void> {
    this.db
      .update(issueClaim)
      .set({ state, resolvedAt: new Date() })
      .where(eq(issueClaim.id, id))
      .run()
  }
}
