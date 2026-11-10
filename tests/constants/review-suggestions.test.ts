import { describe, expect, it } from 'vitest'

import {
  type FileAuthorIndex,
  fileKey,
  isNoiseFile,
  type OpenPullRequest,
  suggestReviews,
} from '../../src/constants/review-suggestions.js'

const REPO = 'digitalgroundgame/website'

function pr(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    repo: REPO,
    number: 1,
    title: 'Tidy the nav',
    htmlUrl: `https://github.com/${REPO}/pull/1`,
    author: 'someone',
    reviewers: [],
    files: ['src/nav.ts'],
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

function index(entries: [string, Record<string, number>][]): FileAuthorIndex {
  return new Map(
    entries.map(([path, counts]) => [fileKey(REPO, path), new Map(Object.entries(counts))]),
  )
}

describe('isNoiseFile', () => {
  it('flags lockfiles, build output and snapshots', () => {
    expect(isNoiseFile('pnpm-lock.yaml')).toBe(true)
    expect(isNoiseFile('packages/app/package-lock.json')).toBe(true)
    expect(isNoiseFile('dist/index.js')).toBe(true)
    expect(isNoiseFile('packages/app/build/out.js')).toBe(true)
    expect(isNoiseFile('tests/__snapshots__/a.test.ts.snap')).toBe(true)
    expect(isNoiseFile('public/app.min.js')).toBe(true)
  })

  it('leaves source alone', () => {
    expect(isNoiseFile('src/nav.ts')).toBe(false)
    expect(isNoiseFile('src/builder.ts')).toBe(false)
    expect(isNoiseFile('README.md')).toBe(false)
  })
})

describe('suggestReviews', () => {
  it('suggests a pull request touching a file the member has committed to', () => {
    const result = suggestReviews([pr()], index([['src/nav.ts', { alice: 3 }]]), 'Alice')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ matchedFiles: ['src/nav.ts'], commits: 3 })
  })

  it('suggests nothing when the member has not touched any of the files', () => {
    expect(suggestReviews([pr()], index([['src/nav.ts', { bob: 3 }]]), 'alice')).toEqual([])
  })

  it('skips the member’s own pull requests', () => {
    const own = pr({ author: 'alice' })
    expect(suggestReviews([own], index([['src/nav.ts', { alice: 3 }]]), 'alice')).toEqual([])
  })

  it('skips pull requests the member is already reviewing', () => {
    const reviewing = pr({ reviewers: ['alice'] })
    expect(suggestReviews([reviewing], index([['src/nav.ts', { alice: 3 }]]), 'alice')).toEqual([])
  })

  it('does not match a path in another repository', () => {
    const elsewhere = pr({ repo: 'digitalgroundgame/other' })
    expect(suggestReviews([elsewhere], index([['src/nav.ts', { alice: 3 }]]), 'alice')).toEqual([])
  })

  it('ranks by matched files, then commits, then longest waiting', () => {
    const idx = index([
      ['a.ts', { alice: 1 }],
      ['b.ts', { alice: 1 }],
      ['c.ts', { alice: 9 }],
    ])
    const twoFiles = pr({ number: 1, files: ['a.ts', 'b.ts'] })
    const manyCommits = pr({ number: 2, files: ['c.ts'] })
    const olderOneCommit = pr({ number: 3, files: ['a.ts'], updatedAt: new Date('2026-01-01') })
    const newerOneCommit = pr({ number: 4, files: ['b.ts'], updatedAt: new Date('2026-10-01') })

    const result = suggestReviews(
      [newerOneCommit, olderOneCommit, manyCommits, twoFiles],
      idx,
      'alice',
      4,
    )
    expect(result.map((s) => s.pr.number)).toEqual([1, 2, 3, 4])
  })

  it('honours the limit', () => {
    const prs = [1, 2, 3].map((number) => pr({ number }))
    expect(suggestReviews(prs, index([['src/nav.ts', { alice: 1 }]]), 'alice', 2)).toHaveLength(2)
  })
})
