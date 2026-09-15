import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface KudosConfig {
  allowedRoleKeys: string[]
  giveCooldownDays: number
}

const rawConfig = (Config.kudos ?? {}) as Partial<KudosConfig>

/** Role config keys (see `config.roles`) allowed to run `/kudos give`. */
export const KudosGiveAllowedRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
  'config.kudos.allowedRoleKeys',
  '/kudos give',
)

/** Days a giver must wait before giving the same receiver kudos again. */
export const KudosGiveCooldownDays: number = (() => {
  const raw = rawConfig.giveCooldownDays
  if (raw === undefined) return 7
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `config.kudos.giveCooldownDays must be a positive number of days (got: ${String(raw)}); a zero or negative value would disable the /kudos give cooldown`,
    )
  }
  return raw
})()

/** The community's local time zone; leaderboard weeks/months start at local midnight. */
export const KudosLeaderboardTimeZone = 'America/New_York'

/** Window in which receiver DMs are combined into one editable notification. */
export const KudosNotificationWindowMs = 60 * 60 * 1000
