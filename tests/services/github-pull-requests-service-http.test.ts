import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))
vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GitHubPullRequestsService } from '../../src/services/github-pull-requests-service.js'

const REPO = 'digitalgroundgame/website'

function response(status: number, body: unknown = {}): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function review(login: string, state: string, submittedAt: string | null): unknown {
  return { user: { login }, state, submitted_at: submittedAt }
}

describe('GitHubPullRequestsService', () => {
  const service = new GitHubPullRequestsService('token', 'digitalgroundgame')

  beforeEach(() => {
    fetchMock.mockReset()
  })

  describe('getPullRequestStatus', () => {
    it('reads the state and submitted reviews, lowercasing logins', async () => {
      fetchMock.mockResolvedValueOnce(response(200, { state: 'open' })).mockResolvedValueOnce(
        response(200, [
          review('Alice', 'COMMENTED', '2026-11-19T01:00:00Z'),
          // A pending review has no submission time yet.
          review('Bob', 'PENDING', null),
        ]),
      )

      expect(await service.getPullRequestStatus(REPO, 17)).toEqual({
        state: 'open',
        reviews: [
          { login: 'alice', state: 'COMMENTED', submittedAt: new Date('2026-11-19T01:00:00Z') },
        ],
      })
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/repos/${REPO}/pulls/17`)
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
        `/repos/${REPO}/pulls/17/reviews?per_page=100&page=1`,
      )
    })

    // GitHub reports a merged pull request as closed.
    it('reads a merged or closed pull request as closed', async () => {
      fetchMock
        .mockResolvedValueOnce(response(200, { state: 'closed', merged: true }))
        .mockResolvedValueOnce(response(200, []))
      expect(await service.getPullRequestStatus(REPO, 17)).toEqual({ state: 'closed', reviews: [] })
    })

    it('reads further pages of reviews until one comes back short', async () => {
      const fullPage = Array.from({ length: 100 }, (_, i) =>
        review(`user${i}`, 'APPROVED', '2026-11-01T00:00:00Z'),
      )
      fetchMock
        .mockResolvedValueOnce(response(200, { state: 'open' }))
        .mockResolvedValueOnce(response(200, fullPage))
        .mockResolvedValueOnce(response(200, [review('Late', 'APPROVED', '2026-11-02T00:00:00Z')]))

      const status = await service.getPullRequestStatus(REPO, 17)
      expect(status?.reviews).toHaveLength(101)
      expect(status?.reviews.at(-1)?.login).toBe('late')
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(String(fetchMock.mock.calls[2]?.[0])).toContain('page=2')
    })

    // A review request whose status can't be read is left for the next run, never expired.
    it('returns null when the pull request or its reviews can’t be read', async () => {
      fetchMock.mockResolvedValueOnce(response(404))
      expect(await service.getPullRequestStatus(REPO, 17)).toBeNull()

      fetchMock.mockResolvedValueOnce(response(200, { message: 'not a pull request' }))
      expect(await service.getPullRequestStatus(REPO, 17)).toBeNull()

      fetchMock
        .mockResolvedValueOnce(response(200, { state: 'open' }))
        .mockResolvedValueOnce(response(502))
      expect(await service.getPullRequestStatus(REPO, 17)).toBeNull()
    })

    it('returns null when a read times out', async () => {
      const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      })
      fetchMock.mockRejectedValueOnce(timeout)
      expect(await service.getPullRequestStatus(REPO, 17)).toBeNull()
    })

    it('does nothing when the service isn’t configured', async () => {
      const unconfigured = new GitHubPullRequestsService(undefined, undefined)
      expect(await unconfigured.getPullRequestStatus(REPO, 17)).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
