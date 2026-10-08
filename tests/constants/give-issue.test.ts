import { describe, expect, it } from 'vitest'

import {
  type CandidateIssue,
  DRAW_SIZE,
  drawIssues,
  issueMatchesSkills,
  partitionBySkills,
  skillSlugsForRoleNames,
  toLabelSlug,
} from '../../src/constants/give-issue.js'

function issue(overrides: Partial<CandidateIssue> & { number: number }): CandidateIssue {
  return {
    repo: 'digitalgroundgame/website',
    title: `Issue ${overrides.number}`,
    htmlUrl: `https://github.com/digitalgroundgame/website/issues/${overrides.number}`,
    labels: ['available'],
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

/** Deterministic stand-in for Math.random: always picks the first candidate. */
const pickFirst = (): number => 0

describe('toLabelSlug', () => {
  it('normalizes a Discord role name onto a GitHub label', () => {
    expect(toLabelSlug('Front End Development')).toBe('front-end-development')
    expect(toLabelSlug('  Back-End  ')).toBe('back-end')
    expect(toLabelSlug('good first issue')).toBe('good-first-issue')
  })

  it('collapses punctuation rather than leaving it in the slug', () => {
    expect(toLabelSlug('UI / UX')).toBe('ui-ux')
    expect(toLabelSlug('C++')).toBe('c')
  })

  it('returns an empty slug for input with nothing to match on', () => {
    expect(toLabelSlug('   ')).toBe('')
    expect(toLabelSlug('!!!')).toBe('')
  })
})

describe('skillSlugsForRoleNames', () => {
  it('slugs every role name', () => {
    const slugs = skillSlugsForRoleNames(['Front End Development', 'Back End Development'])
    expect([...slugs].sort()).toEqual(['back-end-development', 'front-end-development'])
  })

  it('drops the marker label so a role named after it cannot match everything', () => {
    const slugs = skillSlugsForRoleNames(['Available', 'Front End'])
    expect(slugs.has('available')).toBe(false)
    expect(slugs.has('front-end')).toBe(true)
  })

  it('drops role names that slug to nothing', () => {
    expect(skillSlugsForRoleNames(['@everyone', '   ']).size).toBe(1)
  })
})

describe('issueMatchesSkills', () => {
  const skills = skillSlugsForRoleNames(['Front End'])

  it('matches on any one label', () => {
    expect(
      issueMatchesSkills(issue({ number: 1, labels: ['available', 'front-end'] }), skills),
    ).toBe(true)
  })

  it('matches a label whose spelling differs but slugs the same', () => {
    expect(issueMatchesSkills(issue({ number: 2, labels: ['Front End'] }), skills)).toBe(true)
  })

  it('does not match on the marker label alone', () => {
    expect(issueMatchesSkills(issue({ number: 3, labels: ['available'] }), skills)).toBe(false)
  })
})

describe('partitionBySkills', () => {
  it('splits the pool without losing or duplicating an issue', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'front-end'] }),
      issue({ number: 2, labels: ['available', 'back-end'] }),
      issue({ number: 3, labels: ['available'] }),
    ]
    const { matched, unmatched } = partitionBySkills(pool, skillSlugsForRoleNames(['Front End']))
    expect(matched.map((i) => i.number)).toEqual([1])
    expect(unmatched.map((i) => i.number)).toEqual([2, 3])
  })
})

describe('drawIssues', () => {
  const skills = skillSlugsForRoleNames(['Front End'])

  it('draws two matched issues and one wildcard when the pool allows', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'front-end'] }),
      issue({ number: 2, labels: ['available', 'front-end'] }),
      issue({ number: 3, labels: ['available', 'front-end'] }),
      issue({ number: 4, labels: ['available', 'back-end'] }),
    ]
    const drawn = drawIssues(pool, skills, pickFirst)

    expect(drawn).toHaveLength(DRAW_SIZE)
    expect(drawn.filter((d) => !d.wildcard)).toHaveLength(2)
    const wildcards = drawn.filter((d) => d.wildcard)
    expect(wildcards).toHaveLength(1)
    expect(wildcards[0]?.issue.number).toBe(4)
  })

  it('never offers the same issue twice', () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      issue({ number: i + 1, labels: i < 4 ? ['available', 'front-end'] : ['available'] }),
    )
    for (let run = 0; run < 50; run++) {
      const drawn = drawIssues(pool, skills)
      const keys = drawn.map((d) => `${d.issue.repo}#${d.issue.number}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('biases the wildcard toward the stalest unmatched issue', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'front-end'] }),
      issue({ number: 2, labels: ['available', 'front-end'] }),
      issue({ number: 10, labels: ['available'], updatedAt: new Date('2026-09-20T00:00:00Z') }),
      issue({ number: 11, labels: ['available'], updatedAt: new Date('2026-09-10T00:00:00Z') }),
      issue({ number: 12, labels: ['available'], updatedAt: new Date('2025-01-01T00:00:00Z') }),
    ]
    const drawn = drawIssues(pool, skills, pickFirst)
    const wildcard = drawn.find((d) => d.wildcard)
    expect(wildcard?.issue.number).toBe(12)
  })

  it('falls back to all wildcards when no skill role matches anything', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'back-end'] }),
      issue({ number: 2, labels: ['available', 'design'] }),
      issue({ number: 3, labels: ['available', 'docs'] }),
    ]
    const drawn = drawIssues(pool, skills, pickFirst)
    expect(drawn).toHaveLength(DRAW_SIZE)
    expect(drawn.every((d) => d.wildcard)).toBe(true)
  })

  it('backfills from matched issues rather than returning a short draw', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'front-end'] }),
      issue({ number: 2, labels: ['available', 'front-end'] }),
      issue({ number: 3, labels: ['available', 'front-end'] }),
    ]
    const drawn = drawIssues(pool, skills, pickFirst)
    expect(drawn).toHaveLength(DRAW_SIZE)
    // Nothing unmatched exists, so the third card is a matched issue and must
    // not be mislabelled as a wildcard.
    expect(drawn.filter((d) => d.wildcard)).toHaveLength(0)
  })

  it('returns what it can when the pool is smaller than a full draw', () => {
    const drawn = drawIssues([issue({ number: 1, labels: ['available'] })], skills, pickFirst)
    expect(drawn).toHaveLength(1)
  })

  it('returns nothing for an empty pool', () => {
    expect(drawIssues([], skills, pickFirst)).toEqual([])
  })
})
