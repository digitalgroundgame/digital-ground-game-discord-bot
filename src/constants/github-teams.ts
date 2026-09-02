import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** A `/grant-access` team shortname mapped to a GitHub org + team slug. */
export interface GitHubTeamRef {
  org: string
  team: string
}

interface GrantAccessConfig {
  githubTeams: Record<string, GitHubTeamRef>
}

function isGitHubTeamRef(value: unknown): value is GitHubTeamRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<GitHubTeamRef>).org === 'string' &&
    typeof (value as Partial<GitHubTeamRef>).team === 'string'
  )
}

const rawConfig = (Config.grantAccess ?? {}) as Partial<GrantAccessConfig>

/** `/grant-access` team shortname -> GitHub org + team slug. */
export const GitHubTeams: Record<string, GitHubTeamRef> = Object.fromEntries(
  Object.entries(rawConfig.githubTeams ?? {}).filter((entry): entry is [string, GitHubTeamRef] =>
    isGitHubTeamRef(entry[1]),
  ),
)

/** Resolve a team shortname to its GitHub org + team slug, or null if unknown. */
export function getGitHubTeam(shortname: string): GitHubTeamRef | null {
  // Own-property check rather than a plain lookup: the `team` option is
  // autocompleted, not choice-restricted, so a typed `constructor` would
  // otherwise resolve to an inherited `Object.prototype` value and sail past
  // the unknown-team check.
  if (!Object.prototype.hasOwnProperty.call(GitHubTeams, shortname)) return null
  return GitHubTeams[shortname] ?? null
}
