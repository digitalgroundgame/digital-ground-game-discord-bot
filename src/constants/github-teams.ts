import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** A GitHub team discovered from the org, as `/grant-access` sees it. */
export interface GitHubTeam {
  /** Human-readable team name — what autocomplete offers and the reply names. */
  name: string
  /** URL slug the membership API addresses the team by. */
  slug: string
  /** Slug of the parent team, if any. A child team inherits its parent's repository access. */
  parentSlug?: string | null
}

interface GrantAccessConfig {
  excludeTeams: string[]
}

const rawConfig = (Config.grantAccess ?? {}) as Partial<GrantAccessConfig>

/**
 * GitHub team slugs `/grant-access` must never grant, from
 * `grantAccess.excludeTeams`. Teams are otherwise discovered from the org, so
 * this is the only lever for keeping a sensitive team out of reach.
 */
export const GitHubExcludedTeamSlugs: ReadonlySet<string> = new Set(
  (Array.isArray(rawConfig.excludeTeams) ? rawConfig.excludeTeams : [])
    .filter((slug): slug is string => typeof slug === 'string')
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => slug !== ''),
)

/**
 * Whether a team slug is denied: it is excluded itself, or it descends from an
 * excluded team in `teams`. Descendants count because GitHub child teams
 * inherit their parent's repository access. `excluded` defaults to the
 * configured set; it is a parameter so the rules can be exercised without
 * rewriting config.
 */
export function isExcludedGitHubTeam(
  slug: string,
  excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
  teams: readonly GitHubTeam[] = [],
): boolean {
  const parents = new Map(
    teams.map((team) => [team.slug.toLowerCase(), team.parentSlug?.toLowerCase() ?? null]),
  )
  // `seen` guards against a malformed response that loops back on itself.
  const seen = new Set<string>()
  let current: string | null | undefined = slug.trim().toLowerCase()
  while (current && !seen.has(current)) {
    if (excluded.has(current)) return true
    seen.add(current)
    current = parents.get(current)
  }
  return false
}

/**
 * Derive a team's URL slug from its display name, the way GitHub does:
 * lowercase, with every run of non-alphanumeric characters collapsed to a
 * single hyphen. Lets typed input that differs from a team's name only in
 * punctuation or spacing still match that team.
 */
export function toGitHubTeamSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
}

/** Discovered teams that `/grant-access` is allowed to offer, sorted by name. */
export function selectableGitHubTeams(
  teams: readonly GitHubTeam[],
  excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
): GitHubTeam[] {
  return teams
    .filter((team) => !isExcludedGitHubTeam(team.slug, excluded, teams))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve typed input to a discovered team's slug, or null if it is denied,
 * unknown, or unusable.
 *
 * The `team` option is autocompleted rather than choice-restricted, so input
 * is free text. It matches a team by name, by slug, or by the slug its name
 * would get. Only discovered teams resolve: a team's ancestry is what decides
 * whether an exclusion covers it, and that is only known for teams in the
 * list. Callers refresh the list on a miss so a newly created team can still
 * be granted.
 */
export function resolveGitHubTeamSlug(
  input: string,
  teams: readonly GitHubTeam[],
  excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
): string | null {
  const needle = input.trim().toLowerCase()
  if (needle === '') return null

  const derived = toGitHubTeamSlug(input)
  const match = teams.find((team) => {
    const slug = team.slug.toLowerCase()
    return team.name.toLowerCase() === needle || slug === needle || slug === derived
  })
  if (!match) return null
  return isExcludedGitHubTeam(match.slug, excluded, teams) ? null : match.slug
}

/** The roles GitHub accepts in a team membership upsert. */
export const GITHUB_TEAM_ROLES = ['member', 'maintainer'] as const
export type GitHubTeamRole = (typeof GITHUB_TEAM_ROLES)[number]

/** What a grant defaults to when the caller does not pick a role. */
export const DEFAULT_GITHUB_TEAM_ROLE: GitHubTeamRole = 'member'

/** Narrow free text to a role GitHub accepts, falling back to the default. */
export function toGitHubTeamRole(value: string | null | undefined): GitHubTeamRole {
  const needle = value?.trim().toLowerCase()
  return GITHUB_TEAM_ROLES.find((role) => role === needle) ?? DEFAULT_GITHUB_TEAM_ROLE
}
