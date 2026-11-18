import { describe, expect, it } from 'vitest'

import {
  toCandidateIssue,
  toCloser,
  toIssueStatus,
} from '../../src/services/github-issues-service.js'

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 204,
    title: 'Mobile nav overlaps the hero on iOS',
    html_url: 'https://github.com/digitalgroundgame/website/issues/204',
    updated_at: '2026-09-01T00:00:00Z',
    labels: [{ name: 'available' }, { name: 'front-end' }],
    ...overrides,
  }
}

describe('toCandidateIssue', () => {
  it('maps a labelled issue', () => {
    const candidate = toCandidateIssue('digitalgroundgame/website', raw())
    expect(candidate).toMatchObject({
      repo: 'digitalgroundgame/website',
      number: 204,
      title: 'Mobile nav overlaps the hero on iOS',
      labels: ['available', 'front-end'],
    })
    expect(candidate?.updatedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('lowercases labels so matching does not depend on how they were typed', () => {
    const candidate = toCandidateIssue(
      'digitalgroundgame/website',
      raw({ labels: [{ name: 'Available' }, { name: 'Front-End' }] }),
    )
    expect(candidate?.labels).toEqual(['available', 'front-end'])
  })

  it('accepts labels given as bare strings', () => {
    const candidate = toCandidateIssue('r/x', raw({ labels: ['available'] }))
    expect(candidate?.labels).toEqual(['available'])
  })

  it('rejects a pull request', () => {
    expect(
      toCandidateIssue('r/x', raw({ pull_request: { url: 'https://api.github.com/…' } })),
    ).toBeNull()
  })

  // The request already filters on the label. This is the second check, and
  // the one that holds if the query parameter is ever dropped.
  it('rejects an issue without the marker label', () => {
    expect(toCandidateIssue('r/x', raw({ labels: [{ name: 'front-end' }] }))).toBeNull()
    expect(toCandidateIssue('r/x', raw({ labels: [] }))).toBeNull()
    expect(toCandidateIssue('r/x', raw({ labels: undefined }))).toBeNull()
  })

  it('rejects an entry missing the fields the reply renders', () => {
    expect(toCandidateIssue('r/x', raw({ number: undefined }))).toBeNull()
    expect(toCandidateIssue('r/x', raw({ title: 123 }))).toBeNull()
    expect(toCandidateIssue('r/x', raw({ html_url: undefined }))).toBeNull()
  })

  it('rejects an unparseable timestamp rather than sorting on NaN', () => {
    expect(toCandidateIssue('r/x', raw({ updated_at: 'not a date' }))).toBeNull()
    expect(toCandidateIssue('r/x', raw({ updated_at: undefined }))).toBeNull()
  })
})

describe('toIssueStatus', () => {
  it('reads state, close reason and lowercased assignees', () => {
    expect(
      toIssueStatus({
        state: 'closed',
        state_reason: 'completed',
        assignees: [{ login: 'Alice' }, { login: 'bob' }],
      }),
    ).toEqual({
      state: 'closed',
      stateReason: 'completed',
      assignees: ['alice', 'bob'],
      closedByCode: false,
      closerLogin: null,
    })
  })

  it('rejects an entry without a known state', () => {
    expect(toIssueStatus({ state: 'weird' })).toBeNull()
    expect(toIssueStatus(null)).toBeNull()
  })
})

describe('toCloser', () => {
  function closedBy(closer: unknown): unknown {
    return { repository: { issue: { timelineItems: { nodes: [{ closer }] } } } }
  }

  it('counts a merged pull request or a commit as code, and names its author', () => {
    expect(
      toCloser(closedBy({ __typename: 'PullRequest', merged: true, author: { login: 'Alice' } })),
    ).toEqual({ closedByCode: true, closerLogin: 'alice' })
    expect(
      toCloser(closedBy({ __typename: 'Commit', author: { user: { login: 'Bob' } } })),
    ).toEqual({ closedByCode: true, closerLogin: 'bob' })
  })

  it('leaves the author null for a commit without a GitHub account', () => {
    expect(toCloser(closedBy({ __typename: 'Commit', author: { user: null } }))).toEqual({
      closedByCode: true,
      closerLogin: null,
    })
  })

  it('does not count a close by hand or an unmerged pull request', () => {
    const none = { closedByCode: false, closerLogin: null }
    expect(toCloser(closedBy(null))).toEqual(none)
    expect(
      toCloser(closedBy({ __typename: 'PullRequest', merged: false, author: { login: 'alice' } })),
    ).toEqual(none)
  })

  it('rejects an answer without a timeline', () => {
    expect(toCloser({ repository: { issue: null } })).toBeNull()
    expect(toCloser(null)).toBeNull()
  })
})
