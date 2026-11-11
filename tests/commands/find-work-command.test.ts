/* eslint-disable @typescript-eslint/no-explicit-any */
import { Collection } from 'discord.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { CommandDeferType } from '../../src/commands/index.js'
import { FindWorkCommand } from '../../src/commands/chat/find-work-command.js'
import { type CandidateIssue, FindWorkPoints } from '../../src/constants/find-work.js'
import { fileKey, type OpenPullRequest } from '../../src/constants/review-suggestions.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { UserService } from '../../src/services/user-service.js'
import { WorkClaimService } from '../../src/services/work-claim-service.js'
import {
  createMockCommandInteraction,
  createMockGuildMember,
  createMockUser,
} from '../helpers/discord-mocks.js'
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const MEMBER_ID = '333444555666777888'
const INTERACTION_ID = '987612345678901234'
const REPO = 'digitalgroundgame/website'
const data = new EventData(Language.Default, Language.Default)

function issue(overrides: Partial<CandidateIssue> & { number: number }): CandidateIssue {
  return {
    repo: REPO,
    title: `Issue ${overrides.number}`,
    htmlUrl: `https://github.com/${REPO}/issues/${overrides.number}`,
    labels: ['available'],
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

const PULL: OpenPullRequest = {
  repo: REPO,
  number: 17,
  title: 'Fix the nav',
  htmlUrl: `https://github.com/${REPO}/pull/17`,
  author: 'bob',
  reviewers: [],
  files: ['src/nav.ts'],
  updatedAt: new Date('2026-09-01T00:00:00Z'),
}
const FILE_AUTHORS = new Map([[fileKey(REPO, 'src/nav.ts'), new Map([['alice', 3]])]])

const OPEN_UNASSIGNED = {
  state: 'open',
  stateReason: null,
  assignees: [],
  closedByCode: false,
  closerLogin: null,
}

function issuesService(pool: CandidateIssue[], overrides: Record<string, unknown> = {}): any {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    getIssues: vi.fn().mockReturnValue(pool),
    getIssueStatus: vi.fn().mockResolvedValue(OPEN_UNASSIGNED),
    isAssignable: vi.fn().mockResolvedValue(true),
    assign: vi.fn().mockResolvedValue({ status: 'assigned' }),
    ...overrides,
  }
}

function pullRequestsService(
  pulls: OpenPullRequest[] = [],
  overrides: Record<string, unknown> = {},
): any {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    getPullRequests: vi.fn().mockReturnValue(pulls),
    getFileAuthors: vi.fn().mockReturnValue(FILE_AUTHORS),
    requestReview: vi.fn().mockResolvedValue({ status: 'assigned' }),
    ...overrides,
  }
}

/** The button the member presses, or undefined to let the draw time out. */
function button(customId: string): any {
  return {
    customId,
    user: { id: MEMBER_ID, tag: 'member#0001' },
    deferUpdate: vi.fn().mockResolvedValue({}),
    editReply: vi.fn().mockResolvedValue({}),
  }
}

function interaction(pressed: any | undefined, roleNames: string[] = []): any {
  const user = createMockUser({ id: MEMBER_ID, tag: 'member#0001' })
  const roles = new Collection(roleNames.map((name, i) => [`role-${i}`, { id: `role-${i}`, name }]))
  const member = createMockGuildMember({ id: MEMBER_ID, user, roles: { cache: roles } })
  const message = {
    awaitMessageComponent: pressed
      ? vi.fn().mockResolvedValue(pressed)
      : vi.fn().mockRejectedValue(new Error('time')),
  }
  return createMockCommandInteraction({
    id: INTERACTION_ID,
    guildId: GUILD_ID,
    user,
    member,
    deferred: true,
    followUp: vi.fn().mockResolvedValue(message),
  })
}

/** Description of the first embed in a reply or edit. */
function described(call: any): string {
  return call?.[0]?.embeds?.[0]?.data?.description ?? ''
}

const claimButton = (index = 0): any => button(`find-work-claim-${INTERACTION_ID}-${index}`)
const reviewButton = (index = 0): any => button(`find-work-review-${INTERACTION_ID}-${index}`)

describe('FindWorkCommand', () => {
  let db: TestDatabase
  let users: UserService
  let claims: WorkClaimService

  beforeEach(async () => {
    db = createTestDatabase()
    users = new UserService(db)
    claims = new WorkClaimService(db)
    await users.linkAccount(MEMBER_ID, 'github', { externalId: 'alice' })
  })

  function command(issues: any, pulls: any = pullRequestsService()): FindWorkCommand {
    return new FindWorkCommand(issues, users, claims, pulls)
  }

  describe('before the draw', () => {
    it('replies privately', () => {
      expect(command(issuesService([])).deferType).toBe(CommandDeferType.HIDDEN)
    })

    it('says /find-work is unavailable when GitHub is not configured', async () => {
      const issues = issuesService([issue({ number: 1 })], {
        isConfigured: vi.fn().mockReturnValue(false),
      })
      const intr = interaction(undefined)
      await command(issues).execute(intr, data)

      expect(described(intr.followUp.mock.calls[0])).toContain('isn’t configured')
      expect(issues.getIssues).not.toHaveBeenCalled()
    })

    it('asks a member without a linked GitHub account to link one, and shows no draw', async () => {
      const unlinked = new UserService(createTestDatabase())
      const issues = issuesService([issue({ number: 1 })])
      const intr = interaction(undefined)
      await new FindWorkCommand(issues, unlinked, claims, pullRequestsService()).execute(intr, data)

      expect(described(intr.followUp.mock.calls[0])).toContain('/link-account')
      expect(intr.followUp.mock.calls[0]?.[0]?.components).toBeUndefined()
      expect(issues.getIssues).not.toHaveBeenCalled()
    })

    it('says nothing is available when there are no issues and no reviews', async () => {
      const intr = interaction(undefined)
      await command(issuesService([])).execute(intr, data)

      expect(described(intr.followUp.mock.calls[0])).toContain('Nothing is up for grabs')
    })

    it('tells the member when none of their roles matched an issue', async () => {
      const intr = interaction(undefined, ['Front End'])
      await command(issuesService([issue({ number: 1, labels: ['available', 'design'] })])).execute(
        intr,
        data,
      )

      expect(described(intr.followUp.mock.calls[0])).toContain('None of your skill roles matched')
    })

    it('lets only the member who ran the command press its buttons', async () => {
      const pressed = claimButton()
      const intr = interaction(pressed)
      await command(issuesService([issue({ number: 1 })])).execute(intr, data)

      const message = await intr.followUp.mock.results[0]?.value
      const { filter } = message.awaitMessageComponent.mock.calls[0][0]
      expect(filter({ user: { id: MEMBER_ID }, customId: pressed.customId })).toBe(true)
      expect(filter({ user: { id: 'someone-else' }, customId: pressed.customId })).toBe(false)
    })

    it('replaces the draw with an expiry notice when no button is pressed', async () => {
      const intr = interaction(undefined)
      await command(issuesService([issue({ number: 1 })])).execute(intr, data)

      expect(described(intr.editReply.mock.calls[0])).toContain('That draw expired')
      expect(intr.editReply.mock.calls[0]?.[0]?.components).toEqual([])
    })
  })

  describe('claiming an issue', () => {
    it('records the claim, assigns the member and promises the wildcard rate', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })])
      await command(issues).execute(interaction(pressed), data)

      // Answered before any GitHub call, so a slow GitHub can't fail the button.
      expect(pressed.deferUpdate.mock.invocationCallOrder[0]).toBeLessThan(
        issues.getIssueStatus.mock.invocationCallOrder[0],
      )
      expect(issues.assign).toHaveBeenCalledWith(REPO, 42, 'alice')
      expect(await claims.listLiveClaims()).toMatchObject([
        { repo: REPO, issueNumber: 42, githubLogin: 'alice', wildcard: true, guildId: GUILD_ID },
      ])
      const reply = described(pressed.editReply.mock.calls[0])
      expect(reply).toContain('Assigned **alice**')
      expect(reply).toContain(`**${FindWorkPoints.wildcardIssue} `)
    })

    it('promises the ordinary rate for a skill-matched issue', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42, labels: ['available', 'back-end'] })])
      await command(issues).execute(interaction(pressed, ['Back End']), data)

      expect(await claims.listLiveClaims()).toMatchObject([{ issueNumber: 42, wildcard: false }])
      expect(described(pressed.editReply.mock.calls[0])).toContain(`**${FindWorkPoints.issue} `)
    })

    it('refuses an issue someone else already holds a live claim on', async () => {
      await claims.recordClaim({
        guildId: GUILD_ID,
        discordUserId: 'someone-else',
        githubLogin: 'bob',
        repo: REPO,
        issueNumber: 42,
        wildcard: false,
      })
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })])
      await command(issues).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain('just before you did')
      expect(issues.assign).not.toHaveBeenCalled()
      expect(await claims.listLiveClaims()).toMatchObject([{ githubLogin: 'bob' }])
    })

    it('releases the claim when GitHub shows the issue was taken since the draw', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })], {
        getIssueStatus: vi.fn().mockResolvedValue({ ...OPEN_UNASSIGNED, assignees: ['bob'] }),
      })
      await command(issues).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain('just before you did')
      expect(issues.assign).not.toHaveBeenCalled()
      expect(await claims.listLiveClaims()).toEqual([])
    })

    it('releases the claim when the issue cannot be re-read', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })], {
        getIssueStatus: vi.fn().mockResolvedValue(null),
      })
      await command(issues).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain('Couldn’t claim that issue')
      expect(issues.assign).not.toHaveBeenCalled()
      expect(await claims.listLiveClaims()).toEqual([])
    })

    it('explains access is needed and releases the claim when the account is not assignable', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })], {
        isAssignable: vi.fn().mockResolvedValue(false),
      })
      await command(issues).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain(
        'won’t let **alice** be assigned',
      )
      expect(issues.assign).not.toHaveBeenCalled()
      expect(await claims.listLiveClaims()).toEqual([])
    })

    it('releases the claim so the issue can be claimed again when assignment fails', async () => {
      const pressed = claimButton()
      const issues = issuesService([issue({ number: 42 })], {
        assign: vi.fn().mockResolvedValue({ status: 'error', message: '500' }),
      })
      await command(issues).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain('Couldn’t claim that issue')
      expect(await claims.listLiveClaims()).toEqual([])
    })
  })

  describe('taking a review', () => {
    it('requests the review, records it and promises the review points', async () => {
      const pressed = reviewButton()
      const pulls = pullRequestsService([PULL])
      await command(issuesService([]), pulls).execute(interaction(pressed), data)

      expect(pressed.deferUpdate).toHaveBeenCalledOnce()
      expect(pulls.requestReview).toHaveBeenCalledWith(REPO, 17, 'alice')
      expect(await claims.listLiveReviewRequests()).toMatchObject([
        { repo: REPO, pullNumber: 17, githubLogin: 'alice', discordUserId: MEMBER_ID },
      ])
      const reply = described(pressed.editReply.mock.calls[0])
      expect(reply).toContain('Requested a review from **alice**')
      expect(reply).toContain(`**${FindWorkPoints.review} `)
    })

    it('explains access is needed and records nothing when GitHub refuses the reviewer', async () => {
      const pressed = reviewButton()
      const pulls = pullRequestsService([PULL], {
        requestReview: vi.fn().mockResolvedValue({ status: 'not-assignable' }),
      })
      await command(issuesService([]), pulls).execute(interaction(pressed), data)

      expect(described(pressed.editReply.mock.calls[0])).toContain(
        'won’t request a review from **alice**',
      )
      expect(await claims.listLiveReviewRequests()).toEqual([])
    })

    it('shows no reward line when review payouts are turned off', async () => {
      const saved = FindWorkPoints.review
      FindWorkPoints.review = 0
      try {
        const pressed = reviewButton()
        await command(issuesService([]), pullRequestsService([PULL])).execute(
          interaction(pressed),
          data,
        )

        const reply = described(pressed.editReply.mock.calls[0])
        expect(reply).toContain('Requested a review from **alice**')
        expect(reply).not.toContain('earn')
      } finally {
        FindWorkPoints.review = saved
      }
    })
  })
})
