import { type GitHubIssuesService, type IssueStatus } from './github-issues-service.js'
import {
  type GitHubPullRequestsService,
  type PullRequestStatus,
} from './github-pull-requests-service.js'
import { Logger } from './logger.js'
import { type WorkClaimService } from './work-claim-service.js'
import { FindWorkPoints, type FindWorkPointsConfig } from '../constants/find-work.js'
import { type IssueClaim, type ReviewRequest } from '../database/schema.js'

/** What to do with a live claim this run. */
export type PayoutDecision = 'pay' | 'expire' | 'wait'

/** Review states that count as having reviewed. `DISMISSED` and `PENDING` don't. */
const COUNTED_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])

/**
 * Request times are stored to the second, and GitHub's clock is not ours, so
 * a review submitted moments after the request must not be read as one that
 * predates it.
 */
const CLOCK_SKEW_MS = 60_000

/**
 * How long a fresh claim is left alone. `/find-work` records a claim before
 * assigning on GitHub, and the assignment can take several seconds; a run
 * landing in between would otherwise see the claimer unassigned and expire a
 * claim that is about to succeed.
 */
export const CLAIM_GRACE_MS = 10 * 60 * 1000

/**
 * How long an unfinished issue claim stays live. Past this the claim expires
 * even if the claimer is still assigned, so abandoned claims stop costing the
 * payout job a GitHub read every hour.
 */
export const ISSUE_CLAIM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Same as `ISSUE_CLAIM_MAX_AGE_MS`, for review requests nobody got to. */
export const REVIEW_REQUEST_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Decide an issue claim from the issue's current state.
 *
 * Pays only a claimer who is still assigned when the issue closes as
 * completed through their own code landing: a merged pull request they
 * authored, or a commit they wrote that closes it. A close made by hand
 * expires the claim, because otherwise anyone able to close issues could
 * claim one, close it and be paid for no work; so does a close by someone
 * else's code, since the claimer did not do that work. A claimer who was
 * unassigned — because they dropped it or someone took it over — expires, as
 * does a claim on an issue closed as not planned or a duplicate, and one left
 * open past `ISSUE_CLAIM_MAX_AGE_MS`. A null close reason is treated as
 * completed, since that is what GitHub records when no reason is given.
 */
export function decideIssueClaim(
  claim: Pick<IssueClaim, 'githubLogin' | 'claimedAt'>,
  status: IssueStatus,
  now: Date = new Date(),
): PayoutDecision {
  const login = claim.githubLogin.toLowerCase()
  const age = now.getTime() - claim.claimedAt.getTime()
  const stillAssigned = status.assignees.includes(login)
  if (status.state === 'closed') {
    const completed = status.stateReason === null || status.stateReason === 'completed'
    const byClaimer = status.closedByCode && status.closerLogin === login
    return completed && stillAssigned && byClaimer ? 'pay' : 'expire'
  }
  if (!stillAssigned) return age < CLAIM_GRACE_MS ? 'wait' : 'expire'
  return age > ISSUE_CLAIM_MAX_AGE_MS ? 'expire' : 'wait'
}

/**
 * Decide a review request from the pull request's reviews.
 *
 * Pays once the member has submitted a review since the request, whatever
 * its verdict. A pull request closed or merged without one expires the
 * request, as does one still unreviewed after `REVIEW_REQUEST_MAX_AGE_MS`.
 */
export function decideReviewRequest(
  request: Pick<ReviewRequest, 'githubLogin' | 'requestedAt'>,
  status: PullRequestStatus,
  now: Date = new Date(),
): PayoutDecision {
  const login = request.githubLogin.toLowerCase()
  const since = request.requestedAt.getTime() - CLOCK_SKEW_MS
  const reviewed = status.reviews.some(
    (review) =>
      review.login === login &&
      COUNTED_REVIEW_STATES.has(review.state) &&
      review.submittedAt.getTime() >= since,
  )
  if (reviewed) return 'pay'
  if (status.state === 'closed') return 'expire'
  return now.getTime() - request.requestedAt.getTime() > REVIEW_REQUEST_MAX_AGE_MS
    ? 'expire'
    : 'wait'
}

export interface PayoutSummary {
  paid: number
  expired: number
}

/**
 * Settles `/find-work` claims and pays Democracy Points for finished ones.
 *
 * Run on a schedule by `PayFindWorkJob`. Each live claim costs one or two
 * GitHub reads; one that can't be read is left for the next run rather than
 * expired, so a GitHub outage never costs anyone a payout.
 */
export class FindWorkPayoutService {
  constructor(
    private readonly issuesService: GitHubIssuesService,
    private readonly pullRequestsService: GitHubPullRequestsService,
    private readonly claimService: WorkClaimService,
    /** The bot's user id, recorded as the giver of every payout. */
    private readonly botUserId: string,
    private readonly points: FindWorkPointsConfig = FindWorkPoints,
  ) {}

  public async run(): Promise<PayoutSummary> {
    const summary: PayoutSummary = { paid: 0, expired: 0 }
    await this.settleIssueClaims(summary)
    await this.settleReviewRequests(summary)
    if (summary.paid > 0 || summary.expired > 0) {
      Logger.info(`/find-work payouts: paid ${summary.paid}, expired ${summary.expired}`)
    }
    return summary
  }

  private async settleIssueClaims(summary: PayoutSummary): Promise<void> {
    // Sequential, like the refresh jobs, to stay clear of GitHub's secondary
    // rate limits on concurrent requests from one token.
    for (const claim of await this.claimService.listLiveClaims()) {
      try {
        await this.settleIssueClaim(claim, summary)
      } catch (err: unknown) {
        // One bad row must not hold up everyone else's payout for the hour.
        Logger.error(
          `/find-work: failed to settle the claim on ${claim.repo}#${claim.issueNumber}`,
          err,
        )
      }
    }
  }

  private async settleIssueClaim(claim: IssueClaim, summary: PayoutSummary): Promise<void> {
    const status = await this.issuesService.getIssueStatus(claim.repo, claim.issueNumber)
    if (!status) return

    const decision = decideIssueClaim(claim, status)
    if (decision === 'wait') return

    const points = claim.wildcard ? this.points.wildcardIssue : this.points.issue
    const settled =
      decision === 'pay'
        ? await this.claimService.settleClaim(claim, 'completed', {
            giverDiscordId: this.botUserId,
            reason: `Completed ${claim.repo}#${claim.issueNumber} via /find-work`,
            points,
          })
        : await this.claimService.settleClaim(claim, 'expired')
    if (!settled) return

    if (decision === 'pay') {
      summary.paid++
      Logger.info(
        `/find-work: paid ${points} point(s) to ${claim.discordUserId} for ${claim.repo}#${claim.issueNumber}`,
      )
    } else {
      summary.expired++
    }
  }

  private async settleReviewRequests(summary: PayoutSummary): Promise<void> {
    for (const request of await this.claimService.listLiveReviewRequests()) {
      try {
        await this.settleReviewRequest(request, summary)
      } catch (err: unknown) {
        Logger.error(
          `/find-work: failed to settle the review request on ${request.repo}#${request.pullNumber}`,
          err,
        )
      }
    }
  }

  private async settleReviewRequest(request: ReviewRequest, summary: PayoutSummary): Promise<void> {
    const status = await this.pullRequestsService.getPullRequestStatus(
      request.repo,
      request.pullNumber,
    )
    if (!status) return

    const decision = decideReviewRequest(request, status)
    if (decision === 'wait') return

    const settled =
      decision === 'pay'
        ? await this.claimService.settleReviewRequest(request, 'completed', {
            giverDiscordId: this.botUserId,
            reason: `Reviewed ${request.repo}#${request.pullNumber} via /find-work`,
            points: this.points.review,
          })
        : await this.claimService.settleReviewRequest(request, 'expired')
    if (!settled) return

    if (decision === 'pay') {
      summary.paid++
      Logger.info(
        `/find-work: paid ${this.points.review} point(s) to ${request.discordUserId} for reviewing ${request.repo}#${request.pullNumber}`,
      )
    } else {
      summary.expired++
    }
  }
}
