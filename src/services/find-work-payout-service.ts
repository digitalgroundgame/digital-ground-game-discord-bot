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
 * Decide an issue claim from the issue's current state.
 *
 * Pays only a claimer who is still assigned when the issue closes as
 * completed. A claimer who was unassigned — because they dropped it or
 * someone took it over — expires, as does a claim on an issue closed as not
 * planned or a duplicate. A null close reason is treated as completed, since
 * that is what GitHub records when no reason is given.
 */
export function decideIssueClaim(
  claim: Pick<IssueClaim, 'githubLogin'>,
  status: IssueStatus,
): PayoutDecision {
  const stillAssigned = status.assignees.includes(claim.githubLogin.toLowerCase())
  if (status.state === 'closed') {
    const completed = status.stateReason === null || status.stateReason === 'completed'
    return completed && stillAssigned ? 'pay' : 'expire'
  }
  return stillAssigned ? 'wait' : 'expire'
}

/**
 * Decide a review request from the pull request's reviews.
 *
 * Pays once the member has submitted a review since the request, whatever
 * its verdict. A pull request closed or merged without one expires the
 * request.
 */
export function decideReviewRequest(
  request: Pick<ReviewRequest, 'githubLogin' | 'requestedAt'>,
  status: PullRequestStatus,
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
  return status.state === 'closed' ? 'expire' : 'wait'
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
      const status = await this.issuesService.getIssueStatus(claim.repo, claim.issueNumber)
      if (!status) continue

      const decision = decideIssueClaim(claim, status)
      if (decision === 'wait') continue

      const points = claim.wildcard ? this.points.wildcardIssue : this.points.issue
      const settled =
        decision === 'pay'
          ? await this.claimService.settleClaim(claim, 'completed', {
              giverDiscordId: this.botUserId,
              reason: `Completed ${claim.repo}#${claim.issueNumber} via /find-work`,
              points,
            })
          : await this.claimService.settleClaim(claim, 'expired')
      if (!settled) continue

      if (decision === 'pay') {
        summary.paid++
        Logger.info(
          `/find-work: paid ${points} point(s) to ${claim.discordUserId} for ${claim.repo}#${claim.issueNumber}`,
        )
      } else {
        summary.expired++
      }
    }
  }

  private async settleReviewRequests(summary: PayoutSummary): Promise<void> {
    for (const request of await this.claimService.listLiveReviewRequests()) {
      const status = await this.pullRequestsService.getPullRequestStatus(
        request.repo,
        request.pullNumber,
      )
      if (!status) continue

      const decision = decideReviewRequest(request, status)
      if (decision === 'wait') continue

      const settled =
        decision === 'pay'
          ? await this.claimService.settleReviewRequest(request, 'completed', {
              giverDiscordId: this.botUserId,
              reason: `Reviewed ${request.repo}#${request.pullNumber} via /find-work`,
              points: this.points.review,
            })
          : await this.claimService.settleReviewRequest(request, 'expired')
      if (!settled) continue

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
}
