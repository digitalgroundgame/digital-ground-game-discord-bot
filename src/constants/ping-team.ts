import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface PingTeamConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.pingTeam ?? {}) as Partial<PingTeamConfig>

/** Role config keys (see `config.roles`) allowed to run `/ping-team`. */
export const PingTeamAllowedRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
  'config.pingTeam.allowedRoleKeys',
  '/ping-team',
)
