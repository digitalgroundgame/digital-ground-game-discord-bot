import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** How many issues a single draw offers. */
export const DRAW_SIZE = 3
/** Of those, how many are matched to the member's skill roles. The rest are wildcards. */
export const MATCHED_SLOTS = 2

/** An open, claimable issue as `/give-issue` sees it. */
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

interface GiveIssueConfig {
  markerLabel: string
  excludeRepos: string[]
  allowedRoleKeys: string[]
}

const rawConfig = (Config.giveIssue ?? {}) as Partial<GiveIssueConfig>

/**
 * The opt-in label an issue must carry to be offered. Curation lives on
 * GitHub rather than in this file — adding the label to an issue is what
 * advertises it, and removing the label withdraws it.
 */
export const GiveIssueMarkerLabel: string =
  typeof rawConfig.markerLabel === 'string' && rawConfig.markerLabel.trim() !== ''
    ? rawConfig.markerLabel.trim().toLowerCase()
    : 'available'

/**
 * Repositories never drawn from, as `owner/name`. The pool is public repos in
 * the org, so this is the only lever for holding one back without unlabelling
 * every issue in it.
 */
export const GiveIssueExcludedRepos: ReadonlySet<string> = new Set(
  (Array.isArray(rawConfig.excludeRepos) ? rawConfig.excludeRepos : [])
    .filter((repo): repo is string => typeof repo === 'string')
    .map((repo) => repo.trim().toLowerCase())
    .filter((repo) => repo !== ''),
)

/**
 * Role config keys (see `config.roles`) allowed to approve an access request
 * raised by a claim. This does *not* gate running `/give-issue` — the command
 * is open to every member.
 */
export const GiveIssueApproverRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
  'config.giveIssue.allowedRoleKeys',
  '/give-issue',
)

/**
 * Normalize a Discord role name or a GitHub label into a comparable slug:
 * lowercase, runs of non-alphanumerics collapsed to a hyphen. "Front End
 * Development" and the label `front-end-development` meet here.
 *
 * Same shape as `toGitHubTeamSlug`, kept separate because the two are matching
 * against different vocabularies and there is no reason they must stay
 * identical.
 */
export function toLabelSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

/**
 * Slugs derived from a member's Discord role names, minus the marker label
 * itself so a role coincidentally named "Available" cannot match everything.
 *
 * Aliases (a role whose name does not slug to any label in use) are out of
 * scope here — see the override file described in the issue.
 */
export function skillSlugsForRoleNames(roleNames: readonly string[]): Set<string> {
  const slugs = new Set<string>()
  for (const name of roleNames) {
    const slug = toLabelSlug(name)
    if (slug !== '' && slug !== GiveIssueMarkerLabel) slugs.add(slug)
  }
  return slugs
}

/** Whether an issue carries at least one label matching the member's skill slugs. */
export function issueMatchesSkills(
  issue: CandidateIssue,
  skillSlugs: ReadonlySet<string>,
): boolean {
  return issue.labels.some((label) => skillSlugs.has(toLabelSlug(label)))
}

/**
 * Split the pool into issues that match the member's skill roles and those
 * that don't. The wildcard slot draws from the second half.
 */
export function partitionBySkills(
  issues: readonly CandidateIssue[],
  skillSlugs: ReadonlySet<string>,
): { matched: CandidateIssue[]; unmatched: CandidateIssue[] } {
  const matched: CandidateIssue[] = []
  const unmatched: CandidateIssue[] = []
  for (const issue of issues) {
    if (issueMatchesSkills(issue, skillSlugs)) matched.push(issue)
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
 * Staleness is a stand-in for the real signal, which is how few members hold
 * the matching skill role. That needs a guild member count the selection layer
 * doesn't have; see the issue.
 */
function stalestFirst(issues: readonly CandidateIssue[]): CandidateIssue[] {
  return [...issues].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
}

/**
 * Draw the issues a member is offered: `MATCHED_SLOTS` from issues matching
 * their skill roles, the remainder wildcards from everything else.
 *
 * Both slots degrade rather than returning short. A member whose skills match
 * nothing gets all wildcards; a member whose skills match everything gets
 * matched issues in the wildcard slot, flagged as such, because an unfilled
 * third card is worse than an unsurprising one. Callers that need to tell the
 * member their roles matched nothing should check `matched` themselves rather
 * than inferring it from the result.
 */
export function drawIssues(
  issues: readonly CandidateIssue[],
  skillSlugs: ReadonlySet<string>,
  random: () => number = Math.random,
): DrawnIssue[] {
  const { matched, unmatched } = partitionBySkills(issues, skillSlugs)

  const matchedPicks = sample(matched, MATCHED_SLOTS, random)
  const pickedKeys = new Set(matchedPicks.map((issue) => `${issue.repo}#${issue.number}`))

  // Weighted rather than uniform: take the stalest third, then pick randomly
  // inside it, so the slot is still a draw and not a fixed leaderboard.
  const wildcardPool = stalestFirst(unmatched)
  const stalest = wildcardPool.slice(0, Math.max(1, Math.ceil(wildcardPool.length / 3)))
  const wildcardPicks = sample(stalest, DRAW_SIZE - matchedPicks.length, random)

  const drawn: DrawnIssue[] = [
    ...matchedPicks.map((issue) => ({ issue, wildcard: false })),
    ...wildcardPicks.map((issue) => ({ issue, wildcard: true })),
  ]

  // Backfill from whatever is left so a thin pool still returns a full draw.
  if (drawn.length < DRAW_SIZE) {
    for (const picked of drawn) pickedKeys.add(`${picked.issue.repo}#${picked.issue.number}`)
    const remaining = issues.filter((issue) => !pickedKeys.has(`${issue.repo}#${issue.number}`))
    for (const issue of sample(remaining, DRAW_SIZE - drawn.length, random)) {
      drawn.push({ issue, wildcard: !issueMatchesSkills(issue, skillSlugs) })
    }
  }

  return drawn
}
