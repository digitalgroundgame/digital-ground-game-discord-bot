import { describe, expect, it } from 'vitest'

import {
  buildHistoryQuery,
  historyPathFor,
  parseHistory,
  toOpenPullRequest,
} from '../../src/services/github-pull-requests-service.js'

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Fix the nav',
    html_url: 'https://github.com/digitalgroundgame/website/pull/42',
    updated_at: '2026-09-01T00:00:00Z',
    draft: false,
    user: { login: 'Author' },
    requested_reviewers: [{ login: 'Reviewer' }],
    ...overrides,
  }
}

describe('toOpenPullRequest', () => {
  it('maps an open pull request with lowercased logins', () => {
    expect(toOpenPullRequest('r/x', raw())).toMatchObject({
      repo: 'r/x',
      number: 42,
      author: 'author',
      reviewers: ['reviewer'],
      files: [],
    })
  })

  it('rejects drafts', () => {
    expect(toOpenPullRequest('r/x', raw({ draft: true }))).toBeNull()
  })

  it('rejects entries missing fields', () => {
    expect(toOpenPullRequest('r/x', raw({ user: null }))).toBeNull()
    expect(toOpenPullRequest('r/x', raw({ number: undefined }))).toBeNull()
    expect(toOpenPullRequest('r/x', raw({ updated_at: 'nope' }))).toBeNull()
  })
})

describe('historyPathFor', () => {
  it('reads a modified file under its own name', () => {
    expect(historyPathFor({ filename: 'src/a.ts', status: 'modified' })).toBe('src/a.ts')
  })

  it('reads a renamed file under its previous name', () => {
    expect(
      historyPathFor({ filename: 'src/b.ts', previous_filename: 'src/a.ts', status: 'renamed' }),
    ).toBe('src/a.ts')
  })

  it('skips added files and noise', () => {
    expect(historyPathFor({ filename: 'src/new.ts', status: 'added' })).toBeNull()
    expect(historyPathFor({ filename: 'pnpm-lock.yaml', status: 'modified' })).toBeNull()
  })
})

describe('buildHistoryQuery', () => {
  it('passes paths as variables, never in the query text', () => {
    const path = 'src/") { evil } #.ts'
    const { query, variables } = buildHistoryQuery('org', 'repo', [path])
    expect(query).not.toContain(path)
    expect(variables).toEqual({ owner: 'org', name: 'repo', p0: path })
    expect(query).toContain('f0: history(')
  })
})

describe('parseHistory', () => {
  const commit = (...logins: (string | null)[]): unknown => ({
    authors: { nodes: logins.map((login) => ({ user: login === null ? null : { login } })) },
  })

  it('counts commits per author, including co-authors, once per commit', () => {
    const data = {
      repository: {
        defaultBranchRef: {
          target: {
            f0: { nodes: [commit('Alice', 'Bob'), commit('alice', 'ALICE'), commit(null)] },
            f1: { nodes: [] },
          },
        },
      },
    }
    const result = parseHistory(data, ['a.ts', 'b.ts'])
    expect(result.get('a.ts')).toEqual(
      new Map([
        ['alice', 2],
        ['bob', 1],
      ]),
    )
    expect(result.has('b.ts')).toBe(false)
  })

  it('returns nothing for an empty repository', () => {
    expect(parseHistory({ repository: { defaultBranchRef: null } }, ['a.ts']).size).toBe(0)
  })
})
