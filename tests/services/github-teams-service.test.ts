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

function teamsResponse(teams: unknown[]): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => teams,
    text: async () => JSON.stringify(teams),
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
    it('is true only when a non-blank token and org are both set', () => {
      expect(new GitHubTeamsService('ghp_token', 'dgg').isConfigured()).toBe(true)
      expect(new GitHubTeamsService(undefined, 'dgg').isConfigured()).toBe(false)
      expect(new GitHubTeamsService('', 'dgg').isConfigured()).toBe(false)
      expect(new GitHubTeamsService('   ', 'dgg').isConfigured()).toBe(false)
      expect(new GitHubTeamsService('ghp_token', undefined).isConfigured()).toBe(false)
      expect(new GitHubTeamsService('ghp_token', '   ').isConfigured()).toBe(false)
    })

    it('exposes the trimmed organization', () => {
      expect(new GitHubTeamsService('t', '  dgg  ').organization).toBe('dgg')
      expect(new GitHubTeamsService('t', ' ').organization).toBeUndefined()
    })
  })

  describe('addMember', () => {
    it('reports not-configured without calling the API when no token is set', async () => {
      const service = new GitHubTeamsService('  ', 'dgg')

      const result = await service.addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'not-configured' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('PUTs to the membership endpoint with the authenticated headers', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))
      const service = new GitHubTeamsService('  ghp_token  ', '  dgg org  ')

      await service.addMember('dev-team', 'octo cat')

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

    it('defaults to the member role when none is given', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))

      await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      const [, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(init.body).toBe(JSON.stringify({ role: 'member' }))
    })

    it('sends the requested role in the body', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))

      await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat', 'maintainer')

      const [, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(init.body).toBe(JSON.stringify({ role: 'maintainer' }))
    })

    it('returns active when the membership is live', async () => {
      fetchMock.mockResolvedValue(membershipResponse('active'))

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'active' })
    })

    it('returns pending when GitHub emailed an org invite instead', async () => {
      fetchMock.mockResolvedValue(membershipResponse('pending'))

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'pending' })
    })

    it('treats a success with no state as active', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'active' })
    })

    it('returns the status and body for a rejected request', async () => {
      fetchMock.mockResolvedValue(errorResponse(403, '{"message":"Must be an org owner"}'))

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

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

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: '502' })
    })

    it('names the timeout when the request never settles', async () => {
      const timeout = new Error('The operation was aborted due to timeout')
      timeout.name = 'TimeoutError'
      fetchMock.mockRejectedValue(timeout)

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'no response after 10000ms' })
    })

    it('surfaces the message from a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND api.github.com'))

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'ENOTFOUND api.github.com' })
    })

    it('stringifies a non-Error rejection', async () => {
      fetchMock.mockRejectedValue('boom')

      const result = await new GitHubTeamsService('t', 'dgg').addMember('dev-team', 'octocat')

      expect(result).toEqual({ status: 'error', message: 'boom' })
    })
  })

  describe('team discovery', () => {
    it('starts with an empty cache and fetches nothing on its own', () => {
      const service = new GitHubTeamsService('t', 'dgg')

      expect(service.getTeams()).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('GETs the org team list with the authenticated headers', async () => {
      fetchMock.mockResolvedValue(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))
      const service = new GitHubTeamsService('  ghp_token  ', 'dgg org')

      await service.refreshTeams()

      const [url, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>]
      expect(url).toBe('https://api.github.com/orgs/dgg%20org/teams?per_page=100&page=1')
      expect(init.method).toBe('get')
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer ghp_token',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      })
      expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('caches the name and slug of every discovered team', async () => {
      fetchMock.mockResolvedValue(
        teamsResponse([
          { name: 'Blue Book', slug: 'blue-book', id: 1, privacy: 'closed' },
          { name: 'CRM', slug: 'crm', id: 2 },
        ]),
      )
      const service = new GitHubTeamsService('t', 'dgg')

      expect(await service.refreshTeams()).toBe(true)
      expect(service.getTeams()).toEqual([
        { name: 'Blue Book', slug: 'blue-book' },
        { name: 'CRM', slug: 'crm' },
      ])
    })

    it('skips entries that are not shaped like a team', async () => {
      fetchMock.mockResolvedValue(
        teamsResponse([
          { name: 'Blue Book', slug: 'blue-book' },
          { name: 'No Slug' },
          { slug: 'no-name' },
          { name: '', slug: '' },
          null,
          'not-a-team',
        ]),
      )
      const service = new GitHubTeamsService('t', 'dgg')

      await service.refreshTeams()

      expect(service.getTeams()).toEqual([{ name: 'Blue Book', slug: 'blue-book' }])
    })

    it('keeps paging while a full page comes back', async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ name: `T${i}`, slug: `t${i}` }))
      fetchMock
        .mockResolvedValueOnce(teamsResponse(full))
        .mockResolvedValueOnce(teamsResponse([{ name: 'Last', slug: 'last' }]))
      const service = new GitHubTeamsService('t', 'dgg')

      await service.refreshTeams()

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect((fetchMock.mock.calls[1] as [string])[0]).toContain('page=2')
      expect(service.getTeams()).toHaveLength(101)
    })

    it('stops after a short page without asking for another', async () => {
      fetchMock.mockResolvedValue(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))

      await new GitHubTeamsService('t', 'dgg').refreshTeams()

      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('fetches nothing when the org is unset', async () => {
      const service = new GitHubTeamsService('t', undefined)

      expect(await service.refreshTeams()).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps the previously cached teams when a refresh fails', async () => {
      fetchMock.mockResolvedValueOnce(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))
      const service = new GitHubTeamsService('t', 'dgg')
      await service.refreshTeams()

      fetchMock.mockResolvedValueOnce(errorResponse(403, 'Forbidden'))

      expect(await service.refreshTeams()).toBe(false)
      expect(service.getTeams()).toEqual([{ name: 'Blue Book', slug: 'blue-book' }])
    })

    it('survives a body that is not an array', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ teams: [] }) })

      const service = new GitHubTeamsService('t', 'dgg')

      expect(await service.refreshTeams()).toBe(false)
      expect(service.getTeams()).toEqual([])
    })

    it('survives a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND api.github.com'))

      const service = new GitHubTeamsService('t', 'dgg')

      expect(await service.refreshTeams()).toBe(false)
      expect(service.getTeams()).toEqual([])
    })

    it('coalesces concurrent refreshes into one request', async () => {
      fetchMock.mockResolvedValue(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))
      const service = new GitHubTeamsService('t', 'dgg')

      await Promise.all([service.refreshTeams(), service.refreshTeams(), service.refreshTeams()])

      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })

  describe('warmTeams', () => {
    it('fills an empty cache in the background', async () => {
      fetchMock.mockResolvedValue(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))
      const service = new GitHubTeamsService('t', 'dgg')

      service.warmTeams()

      await vi.waitFor(() => expect(service.getTeams()).toHaveLength(1))
    })

    it('does nothing once the cache is populated', async () => {
      fetchMock.mockResolvedValue(teamsResponse([{ name: 'Blue Book', slug: 'blue-book' }]))
      const service = new GitHubTeamsService('t', 'dgg')
      await service.refreshTeams()

      service.warmTeams()
      service.warmTeams()

      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('does nothing when the service is unconfigured', () => {
      new GitHubTeamsService(undefined, undefined).warmTeams()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('backs off after a failure instead of retrying per keystroke', async () => {
      fetchMock.mockResolvedValue(errorResponse(500, 'boom'))
      const service = new GitHubTeamsService('t', 'dgg')

      await service.refreshTeams()
      // Autocomplete fires on every character typed; without the cooldown each
      // one would hit a still-failing API.
      for (let i = 0; i < 10; i++) service.warmTeams()

      expect(fetchMock).toHaveBeenCalledOnce()
    })
  })
})
