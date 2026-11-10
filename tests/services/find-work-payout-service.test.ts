import { beforeEach, describe, expect, it } from 'vitest'

import { issueClaim, kudosTransaction } from '../../src/database/schema.js'
import {
  CLAIM_GRACE_MS,
  decideIssueClaim,
  decideReviewRequest,
  FindWorkPayoutService,
  ISSUE_CLAIM_MAX_AGE_MS,
  REVIEW_REQUEST_MAX_AGE_MS,
} from '../../src/services/find-work-payout-service.js'
import {
  type GitHubIssuesService,
  type IssueStatus,
} from '../../src/services/github-issues-service.js'
import {
  type GitHubPullRequestsService,
  type PullRequestStatus,
} from '../../src/services/github-pull-requests-service.js'
import { WorkClaimService } from '../../src/services/work-claim-service.js'
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js'

const POINTS = { issue: 1, wildcardIssue: 2, review: 1 }

function issue(overrides: Partial<IssueStatus> = {}): IssueStatus {
  return {
    state: 'open',
    stateReason: null,
    assignees: ['alice'],
    closedByCode: false,
    closerLogin: null,
    ...overrides,
  }
}

describe('decideIssueClaim', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const claim = { githubLogin: 'Alice', claimedAt: new Date('2026-10-01T12:00:00Z') }
  const byAlice = { closedByCode: true, closerLogin: 'alice' }

  it('waits while the issue is open and the claimer is assigned', () => {
    expect(decideIssueClaim(claim, issue(), now)).toBe('wait')
  })

  it('pays when code closes it as completed with the claimer still assigned', () => {
    const closed = { state: 'closed', ...byAlice } as const
    expect(decideIssueClaim(claim, issue({ ...closed, stateReason: 'completed' }))).toBe('pay')
    expect(decideIssueClaim(claim, issue({ ...closed, stateReason: null }))).toBe('pay')
  })

  // The claimer only held the issue; whoever wrote the closing code did the work.
  it('expires when someone else’s code closes it, even with the claimer still assigned', () => {
    const closed = { state: 'closed', stateReason: 'completed', closedByCode: true } as const
    expect(decideIssueClaim(claim, issue({ ...closed, closerLogin: 'bob' }))).toBe('expire')
    // A commit whose author has no GitHub account can't be attributed.
    expect(decideIssueClaim(claim, issue({ ...closed, closerLogin: null }))).toBe('expire')
  })

  // Otherwise anyone who can close issues could claim one, close it, and be paid.
  it('expires when it was closed by hand', () => {
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: 'completed' }))).toBe(
      'expire',
    )
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: null }))).toBe('expire')
  })

  it('expires when it closes as not planned or a duplicate', () => {
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: 'not_planned' }))).toBe(
      'expire',
    )
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: 'duplicate' }))).toBe(
      'expire',
    )
  })

  // Whoever took it over did the work; the original claimer dropped it.
  it('expires when the claimer is no longer assigned, open or closed', () => {
    expect(decideIssueClaim(claim, issue({ assignees: ['bob'] }), now)).toBe('expire')
    expect(
      decideIssueClaim(
        claim,
        issue({ state: 'closed', stateReason: 'completed', assignees: ['bob'], ...byAlice }),
        now,
      ),
    ).toBe('expire')
  })

  // The claim is recorded before the GitHub assignment lands, so a run in
  // that gap must not read the missing assignee as a dropped claim.
  it('waits on a fresh claim whose assignment has not landed yet', () => {
    const fresh = { ...claim, claimedAt: new Date(now.getTime() - CLAIM_GRACE_MS + 1000) }
    expect(decideIssueClaim(fresh, issue({ assignees: [] }), now)).toBe('wait')
    const settled = { ...claim, claimedAt: new Date(now.getTime() - CLAIM_GRACE_MS - 1000) }
    expect(decideIssueClaim(settled, issue({ assignees: [] }), now)).toBe('expire')
  })

  it('expires a claim left open past the maximum age', () => {
    const old = { ...claim, claimedAt: new Date(now.getTime() - ISSUE_CLAIM_MAX_AGE_MS - 1000) }
    expect(decideIssueClaim(old, issue(), now)).toBe('expire')
  })
})

describe('decideReviewRequest', () => {
  const requestedAt = new Date('2026-10-01T12:00:00Z')
  const request = { githubLogin: 'Alice', requestedAt }

  function pull(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
    return { state: 'open', reviews: [], ...overrides }
  }

  it('pays for any submitted verdict since the request', () => {
    for (const state of ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']) {
      const status = pull({
        reviews: [{ login: 'alice', state, submittedAt: new Date('2026-10-02T00:00:00Z') }],
      })
      expect(decideReviewRequest(request, status)).toBe('pay')
    }
  })

  it('does not count a dismissed review, someone else’s, or one from before the request', () => {
    const status = pull({
      reviews: [
        { login: 'alice', state: 'DISMISSED', submittedAt: new Date('2026-10-02T00:00:00Z') },
        { login: 'bob', state: 'APPROVED', submittedAt: new Date('2026-10-02T00:00:00Z') },
        { login: 'alice', state: 'APPROVED', submittedAt: new Date('2026-09-01T00:00:00Z') },
      ],
    })
    expect(decideReviewRequest(request, status, new Date('2026-10-02T12:00:00Z'))).toBe('wait')
  })

  it('tolerates a review timestamped a moment before the stored request time', () => {
    const status = pull({
      reviews: [
        { login: 'alice', state: 'APPROVED', submittedAt: new Date('2026-10-01T11:59:30Z') },
      ],
    })
    expect(decideReviewRequest(request, status)).toBe('pay')
  })

  it('expires when the pull request closes without a review', () => {
    expect(decideReviewRequest(request, pull({ state: 'closed' }))).toBe('expire')
  })

  it('expires a request still unreviewed past the maximum age', () => {
    const later = new Date(requestedAt.getTime() + REVIEW_REQUEST_MAX_AGE_MS + 1000)
    expect(decideReviewRequest(request, pull(), later)).toBe('expire')
    const sooner = new Date(requestedAt.getTime() + REVIEW_REQUEST_MAX_AGE_MS - 1000)
    expect(decideReviewRequest(request, pull(), sooner)).toBe('wait')
  })
})

describe('FindWorkPayoutService', () => {
  let db: TestDatabase
  let claims: WorkClaimService
  let issueStatus: IssueStatus | null
  let pullStatus: PullRequestStatus | null

  const issues = {
    getIssueStatus: async () => issueStatus,
  } as unknown as GitHubIssuesService
  const pulls = {
    getPullRequestStatus: async () => pullStatus,
  } as unknown as GitHubPullRequestsService

  beforeEach(async () => {
    db = createTestDatabase()
    claims = new WorkClaimService(db)
    issueStatus = null
    pullStatus = null
    await claims.recordClaim({
      guildId: 'guild-1',
      discordUserId: 'member-1',
      githubLogin: 'alice',
      repo: 'org/site',
      issueNumber: 7,
      wildcard: true,
    })
    await claims.recordReviewRequest({
      guildId: 'guild-1',
      discordUserId: 'member-2',
      githubLogin: 'bob',
      repo: 'org/site',
      pullNumber: 9,
    })
  })

  function service(): FindWorkPayoutService {
    return new FindWorkPayoutService(issues, pulls, claims, 'bot-1', POINTS)
  }

  it('leaves claims alone when GitHub can’t be read', async () => {
    expect(await service().run()).toEqual({ paid: 0, expired: 0 })
    expect(await claims.listLiveClaims()).toHaveLength(1)
    expect(await claims.listLiveReviewRequests()).toHaveLength(1)
  })

  it('pays the wildcard rate for a completed wildcard claim and the review rate for a review', async () => {
    issueStatus = issue({
      state: 'closed',
      stateReason: 'completed',
      closedByCode: true,
      closerLogin: 'alice',
    })
    pullStatus = {
      state: 'open',
      reviews: [{ login: 'bob', state: 'APPROVED', submittedAt: new Date(Date.now() + 1000) }],
    }

    expect(await service().run()).toEqual({ paid: 2, expired: 0 })
    const rows = db.select().from(kudosTransaction).all()
    expect(rows.filter((r) => r.receiverDiscordId === 'member-1')).toHaveLength(2)
    expect(rows.filter((r) => r.receiverDiscordId === 'member-2')).toHaveLength(1)
    expect(rows.every((r) => r.giverDiscordId === 'bot-1' && r.guildId === 'guild-1')).toBe(true)

    // A second run finds nothing left to pay.
    expect(await service().run()).toEqual({ paid: 0, expired: 0 })
    expect(db.select().from(kudosTransaction).all()).toHaveLength(3)
  })

  it('expires without paying', async () => {
    // Past the grace period, so a missing assignee reads as a dropped claim.
    db.update(issueClaim)
      .set({ claimedAt: new Date(Date.now() - CLAIM_GRACE_MS - 60_000) })
      .run()
    issueStatus = issue({ assignees: [] })
    pullStatus = { state: 'closed', reviews: [] }

    expect(await service().run()).toEqual({ paid: 0, expired: 2 })
    expect(db.select().from(kudosTransaction).all()).toEqual([])
  })

  it('keeps settling the rest when one claim fails', async () => {
    await claims.recordClaim({
      guildId: 'guild-1',
      discordUserId: 'member-3',
      githubLogin: 'carol',
      repo: 'org/site',
      issueNumber: 8,
      wildcard: false,
    })
    let calls = 0
    const flaky = {
      getIssueStatus: async (_repo: string, issueNumber: number) => {
        calls++
        if (issueNumber === 7) throw new Error('boom')
        return issue({
          state: 'closed',
          stateReason: 'completed',
          assignees: ['carol'],
          closedByCode: true,
          closerLogin: 'carol',
        })
      },
    } as unknown as GitHubIssuesService

    const run = new FindWorkPayoutService(flaky, pulls, claims, 'bot-1', POINTS)
    expect(await run.run()).toEqual({ paid: 1, expired: 0 })
    expect(calls).toBe(2)
  })

  it('settles a completed claim without a ledger row when its payout is turned off', async () => {
    issueStatus = issue({
      state: 'closed',
      stateReason: 'completed',
      closedByCode: true,
      closerLogin: 'alice',
    })
    const off = new FindWorkPayoutService(issues, pulls, claims, 'bot-1', {
      ...POINTS,
      wildcardIssue: 0,
    })

    expect(await off.run()).toEqual({ paid: 1, expired: 0 })
    expect(db.select().from(kudosTransaction).all()).toEqual([])
    expect(await claims.listLiveClaims()).toEqual([])
  })
})
