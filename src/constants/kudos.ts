import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface KudosConfig {
  allowedRoleKeys: string[]
  giveCooldownDays: number
  emoji: string
}

const rawConfig = (Config.kudos ?? {}) as Partial<KudosConfig>

/**
 * Role config keys (see `config.roles`) allowed to give kudos, by `/kudos give`
 * or by reaction. An empty or missing list lets every member give kudos.
 */
export const KudosGiveAllowedRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
  'config.kudos.allowedRoleKeys',
  'kudos giving',
  { allowEmpty: true },
)

/** Days a giver must wait before giving the same receiver kudos again. */
export const KudosGiveCooldownDays: number = (() => {
  const raw = rawConfig.giveCooldownDays
  if (raw === undefined) return 7
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `config.kudos.giveCooldownDays must be a positive number of days (got: ${String(raw)}); a zero or negative value would disable the kudos cooldown`,
    )
  }
  return raw
})()

/** Reacting to a message with this emoji gives its author kudos. */
export const KudosEmoji: string = (() => {
  const raw = rawConfig.emoji
  if (raw === undefined) return '🪙'
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`config.kudos.emoji must be a non-empty emoji (got: ${String(raw)})`)
  }
  return raw.trim()
})()

/** The community's local time zone; leaderboard weeks/months start at local midnight. */
export const KudosLeaderboardTimeZone = 'America/New_York'
