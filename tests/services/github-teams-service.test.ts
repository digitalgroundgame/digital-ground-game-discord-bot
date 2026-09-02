import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))
vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GitHubTeamsService } from '../../src/services/github-teams-service.js'

/** A successful membership upsert, which GitHub answers with the new state. */
function membershipResponse(state: string): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({ state }),
    text: async () => JSON.stringify({ state }),
  }
}

function errorResponse(status: number, body: string): unknown {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  }
}

describe('GitHubTeamsService', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  describe('isConfigured', () => {
    it('is true only when a non-blank token is set', () => {
      expect(new GitHubTeamsService('ghp_token').isConfigured()).toBe(true)
      expect(new GitHubTeamsService(undefined).isConfigured()).toBe(false)
      expect(new GitHubTeamsService('').isConfigured()).toBe(false)
      expect(new GitHubTeamsService('   ').isConfigured()).toBe(false)
    })
  })

  describe('addMember', () => {
    it('reports not-configured without calling the API when no token is set', async () => {
      const service = new GitHubTeamsService('  ')

      const result = await service.addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'not-configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('PUTs to the membership endpoint with the authenticated headers', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))
      const service = new GitHubTeamsService('  ghp_token  ')

      await service.addMember('dgg org', 'dev-team', 'octo cat')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
      // Each path segment is encoded so a stray space or slash can't escape the URL.
      expect(url).toBe(
        'https://api.github.com/orgs/dgg%20org/teams/dev-team/memberships/octo%20cat',
      )
      expect(init.method).toBe('put')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer ghp_token',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      })
      expect(init.body).toBe(JSON.stringify({ role: 'member' }))
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('returns active when the membership is live', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'active' })
    })

    it('returns pending when GitHub emailed an org invite instead', async () => {
      fetchMock.mockResolvedValue(membershipResponse('pending'))

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'pending' })
    })

    it('treats a success with no state as active', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'active' })
    })

    it('returns the status and body for a rejected request', async () => {
      fetchMock.mockResolvedValue(errorResponse(403, '{"message":"Must be an org owner"}'))

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({
        status: 'error',
        message: '403 {"message":"Must be an org owner"}',
      })
    })

    it('still reports the status when the error body cannot be read', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error('socket hang up')
        },
      })

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: '502' })
    })

    it('names the timeout when the request never settles', async () => {
      const timeout = new Error('The operation was aborted due to timeout')
      timeout.name = 'TimeoutError'
      fetchMock.mockRejectedValue(timeout)

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'no response after 10000ms' })
    })

    it('surfaces the message from a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND api.github.com'))

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'ENOTFOUND api.github.com' })
    })

    it('stringifies a non-Error rejection', async () => {
      fetchMock.mockRejectedValue('boom')

      const result = await new GitHubTeamsService('t').addMember('dgg', 'dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'boom' })
    })
  })
})
