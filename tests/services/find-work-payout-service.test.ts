import { beforeEach, describe, expect, it } from 'vitest'

import { kudosTransaction } from '../../src/database/schema.js'
import {
  decideIssueClaim,
  decideReviewRequest,
  FindWorkPayoutService,
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
  return { state: 'open', stateReason: null, assignees: ['alice'], ...overrides }
}

describe('decideIssueClaim', () => {
  const claim = { githubLogin: 'Alice' }

  it('waits while the issue is open and the claimer is assigned', () => {
    expect(decideIssueClaim(claim, issue())).toBe('wait')
  })

  it('pays when it closes as completed with the claimer still assigned', () => {
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: 'completed' }))).toBe(
      'pay',
    )
    expect(decideIssueClaim(claim, issue({ state: 'closed', stateReason: null }))).toBe('pay')
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
    expect(decideIssueClaim(claim, issue({ assignees: ['bob'] }))).toBe('expire')
    expect(
      decideIssueClaim(
        claim,
        issue({ state: 'closed', stateReason: 'completed', assignees: ['bob'] }),
      ),
    ).toBe('expire')
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
    expect(decideReviewRequest(request, status)).toBe('wait')
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
    issueStatus = issue({ state: 'closed', stateReason: 'completed' })
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
    issueStatus = issue({ assignees: [] })
    pullStatus = { state: 'closed', reviews: [] }

    expect(await service().run()).toEqual({ paid: 0, expired: 2 })
    expect(db.select().from(kudosTransaction).all()).toEqual([])
  })

  it('settles a completed claim without a ledger row when its payout is turned off', async () => {
    issueStatus = issue({ state: 'closed', stateReason: 'completed' })
    const off = new FindWorkPayoutService(issues, pulls, claims, 'bot-1', {
      ...POINTS,
      wildcardIssue: 0,
    })

    expect(await off.run()).toEqual({ paid: 1, expired: 0 })
    expect(db.select().from(kudosTransaction).all()).toEqual([])
    expect(await claims.listLiveClaims()).toEqual([])
  })
})
