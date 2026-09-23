import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** A GitHub team discovered from the org, as `/grant-access` sees it. */
export interface GitHubTeam {
  /** Human-readable team name — what autocomplete offers and the reply names. */
  name: string
  /** URL slug the membership API addresses the team by. */
  slug: string
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
 * Whether a team slug is denied. `excluded` defaults to the configured set;
 * it is a parameter so the rules can be exercised without rewriting config.
 */
export function isExcludedGitHubTeam(
  slug: string,
  excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
): boolean {
  return excluded.has(slug.trim().toLowerCase())
}

/**
 * Derive a team's URL slug from its display name, the way GitHub does:
 * lowercase, with every run of non-alphanumeric characters collapsed to a
 * single hyphen. Used only as a fallback when the discovered team list is
 * cold or stale — GitHub itself is the authority on whether the slug exists.
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
    .filter((team) => !isExcludedGitHubTeam(team.slug, excluded))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve typed input to a team slug, or null if it is denied or unusable.
 *
 * The `team` option is autocompleted rather than choice-restricted, so input
 * is free text: it may name a discovered team, or name a team created since
 * the last refresh. A miss falls back to `toGitHubTeamSlug` so a stale cache
 * never blocks a legitimate grant — an unknown slug simply 404s at the
 * membership call. Exclusions are applied to the resolved slug either way, so
 * the fallback cannot be used to reach a denied team.
 */
export function resolveGitHubTeamSlug(
  input: string,
  teams: readonly GitHubTeam[],
  excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
): string | null {
  const needle = input.trim().toLowerCase()
  if (needle === '') return null

  const match = teams.find(
    (team) => team.name.toLowerCase() === needle || team.slug.toLowerCase() === needle,
  )
  const slug = match?.slug ?? toGitHubTeamSlug(input)
  if (slug === '') return null
  return isExcludedGitHubTeam(slug, excluded) ? null : slug
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
