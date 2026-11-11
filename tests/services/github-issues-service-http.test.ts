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
})
