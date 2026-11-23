import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))
vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GitHubIssuesService } from '../../src/services/github-issues-service.js'

const REPO = 'digitalgroundgame/website'

function response(status: number, body: unknown = {}): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

describe('GitHubIssuesService', () => {
  const service = new GitHubIssuesService('token', 'digitalgroundgame')

  beforeEach(() => {
    fetchMock.mockReset()
  })

  describe('refreshIssues', () => {
    function issue(number: number, labels: string[]): unknown {
      return {
        number,
        title: `Issue ${number}`,
        html_url: `https://github.com/${REPO}/issues/${number}`,
        updated_at: '2026-11-01T00:00:00Z',
        labels: labels.map((name) => ({ name })),
      }
    }

    /** Answers the repo listing, then each label's query by its `labels` parameter. */
    function answerPool(byLabel: Record<string, unknown[]>): void {
      fetchMock.mockImplementation(async (url: unknown) => {
        const parsed = new URL(String(url))
        if (parsed.pathname.endsWith('/repos') && parsed.pathname.startsWith('/orgs/')) {
          return response(200, [{ full_name: REPO, private: false, archived: false }])
        }
        return response(200, byLabel[parsed.searchParams.get('labels') ?? ''] ?? [])
      })
    }

    // GitHub ANDs a comma-separated `labels` filter, so "any of" takes one query each.
    it('asks for each opt-in label separately and keeps an issue labelled twice once', async () => {
      answerPool({
        available: [issue(1, ['available']), issue(2, ['available', 'good first issue'])],
        'good first issue': [issue(2, ['available', 'good first issue'])],
        'help wanted': [issue(3, ['help wanted'])],
      })

      expect(await service.refreshIssues()).toBe(true)
      expect(service.getIssues().map((entry) => entry.number)).toEqual([1, 2, 3])

      const labelQueries = fetchMock.mock.calls
        .map(([url]) => new URL(String(url)))
        .filter((url) => url.pathname === `/repos/${REPO}/issues`)
      expect(labelQueries.map((url) => url.searchParams.get('labels'))).toEqual([
        'available',
        'good first issue',
        'help wanted',
      ])
      for (const url of labelQueries) {
        expect(url.searchParams.get('state')).toBe('open')
        expect(url.searchParams.get('assignee')).toBe('none')
      }
    })

    it('keeps the previous pool when one label’s query fails', async () => {
      answerPool({ available: [issue(1, ['available'])] })
      await service.refreshIssues()

      fetchMock.mockImplementation(async (url: unknown) => {
        const parsed = new URL(String(url))
        if (parsed.pathname.startsWith('/orgs/')) {
          return response(200, [{ full_name: REPO, private: false, archived: false }])
        }
        return parsed.searchParams.get('labels') === 'help wanted'
          ? response(502)
          : response(200, [])
      })
      expect(await service.refreshIssues()).toBe(false)
      expect(service.getIssues().map((entry) => entry.number)).toEqual([1])
    })
  })

  describe('isAssignable', () => {
    it('reads 204 as assignable and 404 as not', async () => {
      fetchMock.mockResolvedValueOnce(response(204))
      expect(await service.isAssignable(REPO, 'alice')).toBe('assignable')
      fetchMock.mockResolvedValueOnce(response(404))
      expect(await service.isAssignable(REPO, 'alice')).toBe('not-assignable')
    })

    // A GitHub fault says nothing about the member's access.
    it('reports a fault, timeout or rate limit as an error, not as missing access', async () => {
      fetchMock.mockResolvedValueOnce(response(502))
      expect(await service.isAssignable(REPO, 'alice')).toBe('error')
      fetchMock.mockResolvedValueOnce(response(403))
      expect(await service.isAssignable(REPO, 'alice')).toBe('error')
      fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      expect(await service.isAssignable(REPO, 'alice')).toBe('error')
    })
  })

  describe('getIssueState', () => {
    it('reads a closed issue with one REST call and no closer lookup', async () => {
      fetchMock.mockResolvedValueOnce(
        response(200, {
          state: 'closed',
          state_reason: 'completed',
          assignees: [{ login: 'Bob' }],
        }),
      )
      expect(await service.getIssueState(REPO, 42)).toEqual({
        state: 'closed',
        stateReason: 'completed',
        assignees: ['bob'],
      })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/repos/${REPO}/issues/42`)
    })

    it('returns null when the issue can’t be read', async () => {
      fetchMock.mockResolvedValueOnce(response(500))
      expect(await service.getIssueState(REPO, 42)).toBeNull()
      fetchMock.mockResolvedValueOnce(response(200, { message: 'not an issue' }))
      expect(await service.getIssueState(REPO, 42)).toBeNull()
    })
  })

  describe('getIssueStatus', () => {
    const closedIssue = {
      state: 'closed',
      state_reason: 'completed',
      assignees: [{ login: 'Alice' }],
    }

    /** `CLOSER_QUERY`'s answer, wrapped the way GraphQL returns it. */
    function closerAnswer(closer: unknown): unknown {
      return { data: { repository: { issue: { timelineItems: { nodes: [{ closer }] } } } } }
    }

    const timeout = (): Error =>
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      })

    it('reads an open issue with one REST call and no closer lookup', async () => {
      fetchMock.mockResolvedValueOnce(
        response(200, { state: 'open', state_reason: null, assignees: [{ login: 'Alice' }] }),
      )
      expect(await service.getIssueStatus(REPO, 42)).toEqual({
        state: 'open',
        stateReason: null,
        assignees: ['alice'],
        closedByCode: false,
        closerLogin: null,
      })
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('reads a close by a merged pull request, naming its author', async () => {
      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(
          response(
            200,
            closerAnswer({ __typename: 'PullRequest', merged: true, author: { login: 'Alice' } }),
          ),
        )
      expect(await service.getIssueStatus(REPO, 42)).toEqual({
        state: 'closed',
        stateReason: 'completed',
        assignees: ['alice'],
        closedByCode: true,
        closerLogin: 'alice',
      })

      const [restUrl] = fetchMock.mock.calls[0] ?? []
      expect(String(restUrl)).toContain(`/repos/${REPO}/issues/42`)
      const [graphqlUrl, init] = fetchMock.mock.calls[1] ?? []
      expect(String(graphqlUrl)).toContain('/graphql')
      expect(JSON.parse(String(init?.body)).variables).toEqual({
        owner: 'digitalgroundgame',
        name: 'website',
        number: 42,
      })
    })

    it('reads a close by a commit, naming the commit’s GitHub author', async () => {
      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(
          response(200, closerAnswer({ __typename: 'Commit', author: { user: { login: 'Bob' } } })),
        )
      expect(await service.getIssueStatus(REPO, 42)).toMatchObject({
        closedByCode: true,
        closerLogin: 'bob',
      })
    })

    it('reads a close by hand as not closed by code', async () => {
      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(response(200, closerAnswer(null)))
      expect(await service.getIssueStatus(REPO, 42)).toMatchObject({
        state: 'closed',
        closedByCode: false,
        closerLogin: null,
      })
    })

    // A claim whose status can't be read is left for the next run, never expired.
    it('returns null when either read fails or answers something unexpected', async () => {
      fetchMock.mockResolvedValueOnce(response(500))
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()

      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(response(502))
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()

      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(response(200, { errors: [{ message: 'rate limited' }] }))
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()

      fetchMock
        .mockResolvedValueOnce(response(200, closedIssue))
        .mockResolvedValueOnce(response(200, { data: { repository: null } }))
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()
    })

    it('returns null when a read times out', async () => {
      fetchMock.mockRejectedValueOnce(timeout())
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()

      fetchMock.mockResolvedValueOnce(response(200, closedIssue)).mockRejectedValueOnce(timeout())
      expect(await service.getIssueStatus(REPO, 42)).toBeNull()
    })
  })

  describe('unassign', () => {
    it('sends a DELETE naming the member, and succeeds once GitHub no longer lists them', async () => {
      fetchMock.mockResolvedValueOnce(response(200, { assignees: [{ login: 'Bob' }] }))
      expect(await service.unassign(REPO, 42, 'Alice')).toBe(true)

      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(String(url)).toContain(`/repos/${REPO}/issues/42/assignees`)
      expect(init).toMatchObject({ method: 'delete' })
      expect(JSON.parse(String(init?.body))).toEqual({ assignees: ['Alice'] })
    })

    it('fails when GitHub still lists the member, whatever the casing', async () => {
      fetchMock.mockResolvedValueOnce(response(200, { assignees: [{ login: 'alice' }] }))
      expect(await service.unassign(REPO, 42, 'Alice')).toBe(false)
    })

    it('fails, without throwing, on an error status or a timeout', async () => {
      fetchMock.mockResolvedValueOnce(response(404))
      expect(await service.unassign(REPO, 42, 'alice')).toBe(false)
      fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
      expect(await service.unassign(REPO, 42, 'alice')).toBe(false)
    })

    it('does nothing when the service isn’t configured', async () => {
      expect(await new GitHubIssuesService(undefined, undefined).unassign(REPO, 42, 'alice')).toBe(
        false,
      )
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
