import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** How many issues a single draw offers. */
export const DRAW_SIZE = 3
/** Of those, how many come from the member's team repositories. The rest are wildcards. */
export const MATCHED_SLOTS = 2

/** An open, claimable issue as `/find-work` sees it. */
export interface CandidateIssue {
  /** `owner/name`, as GitHub spells it. */
  repo: string
  number: number
  title: string
  htmlUrl: string
  /** Label names, lowercased, as they came back from GitHub. */
  labels: string[]
  /** GitHub's `updated_at`, used as the staleness signal for wildcard weighting. */
  updatedAt: Date
}

/** An issue picked for a draw, tagged with which slot it filled. */
export interface DrawnIssue {
  issue: CandidateIssue
  wildcard: boolean
}

interface FindWorkConfig {
  markerLabels: unknown
  /** Retired in favour of `markerLabels`; rejected at startup if still present. */
  markerLabel: unknown
  excludeRepos: string[]
  points: unknown
}

/** Democracy Points paid for finished `/find-work` claims. */
export interface FindWorkPointsConfig {
  issue: number
  wildcardIssue: number
  review: number
}

const rawConfig = (Config.findWork ?? {}) as Partial<FindWorkConfig>

/**
 * Opt-in labels used when `config.findWork.markerLabels` is absent: the
 * bot's own `available`, plus GitHub's standard labels for work that wants an
 * owner, which repositories already apply.
 */
export const DEFAULT_MARKER_LABELS: readonly string[] = Object.freeze([
  'available',
  'good first issue',
  'help wanted',
])

/**
 * Read the opt-in labels from `config.findWork`: lowercased, trimmed and
 * deduplicated, or `DEFAULT_MARKER_LABELS` when `markerLabels` is absent.
 *
 * Throws on a `markerLabels` that isn't a list, an empty list (the pool could
 * never fill), and a name that is blank or contains a comma, since GitHub's
 * `labels` filter splits on commas. Also throws when the retired
 * `markerLabel` key is still present: ignoring it would quietly swap a custom
 * label for the defaults. Exported for tests; the bot reads it once, at
 * import, so a bad value stops startup.
 */
export function parseMarkerLabels(
  config: Readonly<{ markerLabels?: unknown; markerLabel?: unknown }>,
): readonly string[] {
  if (config.markerLabel !== undefined) {
    throw new Error(
      `config.findWork.markerLabel has been replaced by markerLabels, a list of label names; move ${JSON.stringify(config.markerLabel)} into that list`,
    )
  }
  const raw = config.markerLabels
  if (raw === undefined) return DEFAULT_MARKER_LABELS
  if (!Array.isArray(raw)) {
    throw new Error(
      `config.findWork.markerLabels must be a list of label names (got: ${JSON.stringify(raw)})`,
    )
  }

  const labels: string[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.includes(',')) {
      throw new Error(
        `config.findWork.markerLabels entries must be label names that aren't blank and contain no comma (got: ${JSON.stringify(entry)})`,
      )
    }
    const label = entry.trim().toLowerCase()
    if (!labels.includes(label)) labels.push(label)
  }
  if (labels.length === 0) {
    throw new Error(
      'config.findWork.markerLabels must name at least one label; an empty list leaves /find-work with nothing to offer',
    )
  }
  return Object.freeze(labels)
}

/**
 * The opt-in labels, lowercased. An issue carrying any one of them is
 * offered. Curation lives on GitHub rather than in this file — adding one of
 * the labels to an issue is what advertises it, and removing them all
 * withdraws it.
 */
export const FindWorkMarkerLabels: readonly string[] = parseMarkerLabels(rawConfig)

/**
 * Repositories never drawn from, as `owner/name`. The pool is public repos in
 * the org, so this is the only lever for holding one back without unlabelling
 * every issue in it.
 */
export const FindWorkExcludedRepos: ReadonlySet<string> = new Set(
  (Array.isArray(rawConfig.excludeRepos) ? rawConfig.excludeRepos : [])
    .filter((repo): repo is string => typeof repo === 'string')
    .map((repo) => repo.trim().toLowerCase())
    .filter((repo) => repo !== ''),
)

/** Payouts above this are almost certainly a typo, and would swamp the leaderboard. */
const MAX_POINTS_PER_PAYOUT = 10

const POINT_KEYS: readonly (keyof FindWorkPointsConfig)[] = ['issue', 'wildcardIssue', 'review']

function readPoints(
  points: Readonly<Record<string, unknown>>,
  key: keyof FindWorkPointsConfig,
  fallback: number,
): number {
  const raw = points[key]
  if (raw === undefined) return fallback
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_POINTS_PER_PAYOUT) {
    throw new Error(
      `config.findWork.points.${key} must be a whole number from 0 to ${MAX_POINTS_PER_PAYOUT} (got: ${String(raw)})`,
    )
  }
  return raw
}

/**
 * Read `config.findWork.points`, filling in defaults for missing keys and
 * throwing on any value outside 0–10, on a `points` that isn't an object, and
 * on a key it doesn't know, so a misspelled key fails loudly instead of
 * quietly paying the default. Keys starting with `//` are comments, as
 * elsewhere in the config. Exported for tests; the bot reads it once, at
 * import, so a bad value stops startup.
 */
export function parseFindWorkPoints(points: unknown): Readonly<FindWorkPointsConfig> {
  const raw = points ?? {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `config.findWork.points must be an object with ${POINT_KEYS.join(', ')} (got: ${JSON.stringify(raw)})`,
    )
  }
  const entries = raw as Readonly<Record<string, unknown>>
  const unknownKeys = Object.keys(entries).filter(
    (key) => !key.startsWith('//') && !(POINT_KEYS as readonly string[]).includes(key),
  )
  if (unknownKeys.length > 0) {
    throw new Error(
      `config.findWork.points has unknown key(s) ${unknownKeys.join(', ')}; expected ${POINT_KEYS.join(', ')}`,
    )
  }
  return Object.freeze({
    issue: readPoints(entries, 'issue', 1),
    wildcardIssue: readPoints(entries, 'wildcardIssue', 2),
    review: readPoints(entries, 'review', 1),
  })
}

/**
 * Democracy Points paid automatically by the payout job (see
 * `FindWorkPayoutService`) and promised by `/find-work`. Zero turns that kind
 * of payout off. Frozen, so nothing can change what the bot pays at runtime;
 * code that needs other amounts, such as tests, takes them as an argument.
 */
export const FindWorkPoints: Readonly<FindWorkPointsConfig> = parseFindWorkPoints(rawConfig.points)

/** Whether an issue sits in one of the repositories the member's teams reach. */
export function issueInTeamRepos(issue: CandidateIssue, teamRepos: ReadonlySet<string>): boolean {
  return teamRepos.has(issue.repo.toLowerCase())
}

/**
 * Split the pool into issues in the member's team repositories and those
 * elsewhere. `teamRepos` holds lowercased `owner/name`, as
 * `GitHubTeamsService.getMemberTeamRepos` returns them. The wildcard slot
 * draws from the second half.
 */
export function partitionByTeamRepos(
  issues: readonly CandidateIssue[],
  teamRepos: ReadonlySet<string>,
): { matched: CandidateIssue[]; unmatched: CandidateIssue[] } {
  const matched: CandidateIssue[] = []
  const unmatched: CandidateIssue[] = []
  for (const issue of issues) {
    if (issueInTeamRepos(issue, teamRepos)) matched.push(issue)
    else unmatched.push(issue)
  }
  return { matched, unmatched }
}

/**
 * Pick `count` issues at random, without replacement.
 *
 * `random` is injected so the draw can be asserted in tests; production passes
 * nothing and gets `Math.random`.
 */
function sample(
  issues: readonly CandidateIssue[],
  count: number,
  random: () => number,
): CandidateIssue[] {
  const pool = [...issues]
  const picked: CandidateIssue[] = []
  while (picked.length < count && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
    const [issue] = pool.splice(index, 1)
    if (issue) picked.push(issue)
  }
  return picked
}

/**
 * Bias the wildcard toward whatever has been sitting longest, so the slot
 * points at neglected work rather than just unfamiliar work.
 *
 * Staleness is a stand-in for the real signal, which is how few members are
 * on the teams that reach an issue's repository.
 */
function stalestFirst(issues: readonly CandidateIssue[]): CandidateIssue[] {
  return [...issues].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
}

/**
 * Draw the issues a member is offered: `MATCHED_SLOTS` from issues in their
 * team repositories, the remainder wildcards from everything else.
 *
 * Both slots degrade rather than returning short, but only the wildcard slot
 * is ever flagged as one, since the flag prices the payout. A member whose
 * teams reach none of the pool gets one wildcard and the rest backfilled from
 * the pool at the ordinary rate; a member whose teams reach everything gets
 * matched issues in the wildcard slot, unflagged, because an unfilled third
 * card is worse than an unsurprising one. Callers that need to tell the
 * member their teams matched nothing should check `matched` themselves rather
 * than inferring it from the result.
 */
export function drawIssues(
  issues: readonly CandidateIssue[],
  teamRepos: ReadonlySet<string>,
  random: () => number = Math.random,
): DrawnIssue[] {
  const { matched, unmatched } = partitionByTeamRepos(issues, teamRepos)

  const matchedPicks = sample(matched, MATCHED_SLOTS, random)
  const pickedKeys = new Set(matchedPicks.map((issue) => `${issue.repo}#${issue.number}`))

  // Weighted rather than uniform: take the stalest third, then pick randomly
  // inside it, so the slot is still a draw and not a fixed leaderboard.
  const wildcardPool = stalestFirst(unmatched)
  const stalest = wildcardPool.slice(0, Math.max(1, Math.ceil(wildcardPool.length / 3)))
  const wildcardPicks = sample(stalest, DRAW_SIZE - MATCHED_SLOTS, random)

  const drawn: DrawnIssue[] = [
    ...matchedPicks.map((issue) => ({ issue, wildcard: false })),
    ...wildcardPicks.map((issue) => ({ issue, wildcard: true })),
  ]

  // Backfill from whatever is left so a thin pool still returns a full draw.
  // Backfilled cards are never wildcards: a member whose teams match nothing
  // would otherwise draw every card at the wildcard rate.
  if (drawn.length < DRAW_SIZE) {
    for (const picked of drawn) pickedKeys.add(`${picked.issue.repo}#${picked.issue.number}`)
    const remaining = issues.filter((issue) => !pickedKeys.has(`${issue.repo}#${issue.number}`))
    for (const issue of sample(remaining, DRAW_SIZE - drawn.length, random)) {
      drawn.push({ issue, wildcard: false })
    }
  }

  return drawn
}
