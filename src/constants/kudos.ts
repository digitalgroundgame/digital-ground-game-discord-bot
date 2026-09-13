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
export const KudosGiveCooldownDays: number =
  typeof rawConfig.giveCooldownDays === 'number' ? rawConfig.giveCooldownDays : 7

/** Fixed Eastern Standard Time (UTC−05:00), without daylight-saving changes. */
export const KudosLeaderboardTimeZone = 'UTC-5'

/** Window in which receiver DMs are combined into one editable notification. */
export const KudosNotificationWindowMs = 60 * 60 * 1000
