import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))

import { listPublicOrgRepos, PAGE_SIZE } from '../../src/services/github-api.js'

function reposResponse(repos: unknown[]): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => repos,
    text: async () => JSON.stringify(repos),
  }
}

describe('listPublicOrgRepos', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('asks GitHub for public repositories only', async () => {
    fetchMock.mockResolvedValue(reposResponse([]))
    await listPublicOrgRepos('token', 'digitalgroundgame', new Set())
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/orgs/digitalgroundgame/repos?type=public',
    )
  })

  it('leaves out excluded repositories, however they are capitalized', async () => {
    fetchMock.mockResolvedValue(
      reposResponse([
        { full_name: 'digitalgroundgame/website' },
        { full_name: 'DigitalGroundGame/Internal-Tools' },
      ]),
    )
    const repos = await listPublicOrgRepos(
      'token',
      'digitalgroundgame',
      new Set(['digitalgroundgame/internal-tools']),
    )
    expect(repos).toEqual(['digitalgroundgame/website'])
  })

  it('leaves out private and archived repositories even if GitHub returns them', async () => {
    fetchMock.mockResolvedValue(
      reposResponse([
        { full_name: 'digitalgroundgame/website' },
        { full_name: 'digitalgroundgame/secret', private: true },
        { full_name: 'digitalgroundgame/old', archived: true },
      ]),
    )
    const repos = await listPublicOrgRepos('token', 'digitalgroundgame', new Set())
    expect(repos).toEqual(['digitalgroundgame/website'])
  })

  it('reads further pages until one comes back short', async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      full_name: `digitalgroundgame/repo-${i}`,
    }))
    fetchMock
      .mockResolvedValueOnce(reposResponse(fullPage))
      .mockResolvedValueOnce(reposResponse([{ full_name: 'digitalgroundgame/last' }]))
    const repos = await listPublicOrgRepos('token', 'digitalgroundgame', new Set())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(repos).toHaveLength(PAGE_SIZE + 1)
    expect(repos.at(-1)).toBe('digitalgroundgame/last')
  })
})
