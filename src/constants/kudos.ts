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
