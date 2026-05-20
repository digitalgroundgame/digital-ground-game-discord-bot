import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** Service account scope for managing Google Group membership (requires domain-wide delegation). */
export const GOOGLE_DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.group.member',
] as const

interface GrantAccessConfig {
  allowedRoleKeys: string[]
  groups: Record<string, string>
}

const rawConfig = (Config.grantAccess ?? {}) as Partial<GrantAccessConfig>

/** `/grant-access` team shortname -> Workspace Google Group address. */
export const GoogleGroups: Record<string, string> = Object.fromEntries(
  Object.entries(rawConfig.groups ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
)

/** Role config keys (see `config.roles`) allowed to run `/grant-access`. */
export const GrantAccessAllowedRoleKeys: string[] = Array.isArray(rawConfig.allowedRoleKeys)
  ? rawConfig.allowedRoleKeys
  : []

/** Resolve a team shortname to its Google Group address, or null if unknown. */
export function getGoogleGroupAddress(shortname: string): string | null {
  return GoogleGroups[shortname] ?? null
}
