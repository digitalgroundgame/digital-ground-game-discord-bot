import { describe, expect, it } from 'vitest'

import {
  type CandidateIssue,
  DRAW_SIZE,
  drawIssues,
  issueInTeamRepos,
  DEFAULT_MARKER_LABELS,
  FindWorkMarkerLabels,
  MATCHED_SLOTS,
  parseFindWorkPoints,
  parseMarkerLabels,
  partitionByTeamRepos,
} from '../../src/constants/find-work.js'

/** A repository the member's teams reach, and one they don't. */
const TEAM_REPO = 'digitalgroundgame/website'
const OTHER_REPO = 'digitalgroundgame/other'
/** As `GitHubTeamsService.getMemberTeamRepos` returns it: lowercased. */
const teamRepos: ReadonlySet<string> = new Set([TEAM_REPO])

function issue(overrides: Partial<CandidateIssue> & { number: number }): CandidateIssue {
  return {
    repo: OTHER_REPO,
    title: `Issue ${overrides.number}`,
    htmlUrl: `https://github.com/digitalgroundgame/website/issues/${overrides.number}`,
    labels: ['available'],
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  }
}

/** Deterministic stand-in for Math.random: always picks the first candidate. */
const pickFirst = (): number => 0

describe('issueInTeamRepos', () => {
  it("matches an issue in one of the member's team repositories", () => {
    expect(issueInTeamRepos(issue({ number: 1, repo: TEAM_REPO }), teamRepos)).toBe(true)
  })

  it('matches regardless of how GitHub cased the repository', () => {
    expect(
      issueInTeamRepos(issue({ number: 2, repo: 'DigitalGroundGame/Website' }), teamRepos),
    ).toBe(true)
  })

  it('ignores labels, so a label named like a team or role matches nothing', () => {
    expect(
      issueInTeamRepos(issue({ number: 3, labels: ['available', 'website'] }), teamRepos),
    ).toBe(false)
  })

  it('matches nothing for a member on no team', () => {
    expect(issueInTeamRepos(issue({ number: 4, repo: TEAM_REPO }), new Set())).toBe(false)
  })
})

describe('partitionByTeamRepos', () => {
  it('splits the pool without losing or duplicating an issue', () => {
    const pool = [
      issue({ number: 1, repo: TEAM_REPO }),
      issue({ number: 2 }),
      issue({ number: 3, repo: 'digitalgroundgame/elsewhere' }),
    ]
    const { matched, unmatched } = partitionByTeamRepos(pool, teamRepos)
    expect(matched.map((i) => i.number)).toEqual([1])
    expect(unmatched.map((i) => i.number)).toEqual([2, 3])
  })
})

describe('drawIssues', () => {
  it('draws two matched issues and one wildcard when the pool allows', () => {
    const pool = [
      issue({ number: 1, repo: TEAM_REPO }),
      issue({ number: 2, repo: TEAM_REPO }),
      issue({ number: 3, repo: TEAM_REPO }),
      issue({ number: 4, labels: ['available', 'back-end'] }),
    ]
    const drawn = drawIssues(pool, teamRepos, pickFirst)

    expect(drawn).toHaveLength(DRAW_SIZE)
    expect(drawn.filter((d) => !d.wildcard)).toHaveLength(2)
    const wildcards = drawn.filter((d) => d.wildcard)
    expect(wildcards).toHaveLength(1)
    expect(wildcards[0]?.issue.number).toBe(4)
  })

  it('never offers the same issue twice', () => {
    const pool = Array.from({ length: 8 }, (_, i) =>
      issue({ number: i + 1, repo: i < 4 ? TEAM_REPO : OTHER_REPO }),
    )
    for (let run = 0; run < 50; run++) {
      const drawn = drawIssues(pool, teamRepos)
      const keys = drawn.map((d) => `${d.issue.repo}#${d.issue.number}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('biases the wildcard toward the stalest unmatched issue', () => {
    const pool = [
      issue({ number: 1, repo: TEAM_REPO }),
      issue({ number: 2, repo: TEAM_REPO }),
      issue({ number: 10, labels: ['available'], updatedAt: new Date('2026-09-20T00:00:00Z') }),
      issue({ number: 11, labels: ['available'], updatedAt: new Date('2026-09-10T00:00:00Z') }),
      issue({ number: 12, labels: ['available'], updatedAt: new Date('2025-01-01T00:00:00Z') }),
    ]
    const drawn = drawIssues(pool, teamRepos, pickFirst)
    const wildcard = drawn.find((d) => d.wildcard)
    expect(wildcard?.issue.number).toBe(12)
  })

  // The wildcard flag prices the payout, so a member whose teams match
  // nothing must not have every card paid at the wildcard rate.
  it('flags only the wildcard slot when no team repository matches anything', () => {
    const pool = [
      issue({ number: 1, labels: ['available', 'back-end'] }),
      issue({ number: 2, labels: ['available', 'design'] }),
      issue({ number: 3, labels: ['available', 'docs'] }),
    ]
    const drawn = drawIssues(pool, teamRepos, pickFirst)
    expect(drawn).toHaveLength(DRAW_SIZE)
    expect(drawn.filter((d) => d.wildcard)).toHaveLength(DRAW_SIZE - MATCHED_SLOTS)
  })

  it('backfills from matched issues rather than returning a short draw', () => {
    const pool = [
      issue({ number: 1, repo: TEAM_REPO }),
      issue({ number: 2, repo: TEAM_REPO }),
      issue({ number: 3, repo: TEAM_REPO }),
    ]
    const drawn = drawIssues(pool, teamRepos, pickFirst)
    expect(drawn).toHaveLength(DRAW_SIZE)
    // Nothing unmatched exists, so the third card is a matched issue and must
    // not be mislabelled as a wildcard.
    expect(drawn.filter((d) => d.wildcard)).toHaveLength(0)
  })

  it('returns what it can when the pool is smaller than a full draw', () => {
    const drawn = drawIssues([issue({ number: 1, labels: ['available'] })], teamRepos, pickFirst)
    expect(drawn).toHaveLength(1)
  })

  it('returns nothing for an empty pool', () => {
    expect(drawIssues([], teamRepos, pickFirst)).toEqual([])
  })
})

describe('parseFindWorkPoints', () => {
  it('fills in defaults for missing keys', () => {
    expect(parseFindWorkPoints(undefined)).toEqual({ issue: 1, wildcardIssue: 2, review: 1 })
    expect(parseFindWorkPoints({ review: 3 })).toEqual({ issue: 1, wildcardIssue: 2, review: 3 })
  })

  it('accepts 0 to turn a payout off, and 10 as the ceiling', () => {
    expect(parseFindWorkPoints({ issue: 0, wildcardIssue: 10, review: 0 })).toEqual({
      issue: 0,
      wildcardIssue: 10,
      review: 0,
    })
  })

  it.each([50, -1, 1.5, '1', null])('rejects %j, naming the bad key', (value) => {
    expect(() => parseFindWorkPoints({ issue: value })).toThrow('config.findWork.points.issue')
  })

  // Otherwise the typo'd amount is silently ignored and the default is paid.
  it('rejects a misspelled key, naming it', () => {
    expect(() => parseFindWorkPoints({ wildcard: 5 })).toThrow(
      'config.findWork.points has unknown key(s) wildcard',
    )
  })

  it('ignores comment keys, as elsewhere in the config', () => {
    expect(parseFindWorkPoints({ '// NOTE': 'paid per issue', issue: 3 })).toMatchObject({
      issue: 3,
    })
  })

  it.each([3, 'lots', [1, 2, 1]])('rejects a points value of %j that isn’t an object', (value) => {
    expect(() => parseFindWorkPoints(value)).toThrow('config.findWork.points must be an object')
  })

  it('returns amounts nothing can change at runtime', () => {
    const points = parseFindWorkPoints({}) as { issue: number }
    expect(Object.isFrozen(points)).toBe(true)
    expect(() => {
      points.issue = 9
    }).toThrow(TypeError)
  })
})

describe('parseMarkerLabels', () => {
  it('defaults to available, good first issue and help wanted', () => {
    expect(parseMarkerLabels({})).toEqual(['available', 'good first issue', 'help wanted'])
    expect(DEFAULT_MARKER_LABELS).toEqual(['available', 'good first issue', 'help wanted'])
  })

  it('lowercases, trims and deduplicates the configured labels', () => {
    expect(parseMarkerLabels({ markerLabels: [' Help Wanted ', 'help wanted', 'Ready'] })).toEqual([
      'help wanted',
      'ready',
    ])
  })

  // Ignoring it would quietly swap a custom label for the defaults.
  it('rejects the retired markerLabel key, naming its replacement', () => {
    expect(() => parseMarkerLabels({ markerLabel: 'available' })).toThrow(
      'config.findWork.markerLabel has been replaced by markerLabels',
    )
    expect(() =>
      parseMarkerLabels({ markerLabel: 'available', markerLabels: ['available'] }),
    ).toThrow('markerLabels')
  })

  it('rejects an empty list, which could never fill the pool', () => {
    expect(() => parseMarkerLabels({ markerLabels: [] })).toThrow('at least one label')
  })

  it.each(['available', null, { name: 'available' }])(
    'rejects a markerLabels of %j that isn’t a list',
    (value) => {
      expect(() => parseMarkerLabels({ markerLabels: value })).toThrow('must be a list')
    },
  )

  // GitHub's `labels` filter splits on commas, so `a,b` would mean "a and b".
  it.each(['', '   ', 'bug,help wanted', 3, null])('rejects a label of %j', (value) => {
    expect(() => parseMarkerLabels({ markerLabels: ['available', value] })).toThrow(
      'config.findWork.markerLabels entries',
    )
  })

  it('returns a list nothing can change at runtime', () => {
    expect(Object.isFrozen(parseMarkerLabels({ markerLabels: ['available'] }))).toBe(true)
    expect(Object.isFrozen(DEFAULT_MARKER_LABELS)).toBe(true)
  })

  it('reads the committed config', () => {
    expect(FindWorkMarkerLabels).toEqual(['available', 'good first issue', 'help wanted'])
  })
})
