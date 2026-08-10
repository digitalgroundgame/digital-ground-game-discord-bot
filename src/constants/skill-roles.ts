import { createRequire } from 'node:module'

import { type RoleKey, validateAllowedRoleKeys } from './server-roles.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface PingSkillRoleConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.pingSkillRole ?? {}) as Partial<PingSkillRoleConfig>

/** Role config keys (see `config.roles`) allowed to run `/ping-skill-role`. */
export const PingSkillRoleAllowedRoleKeys: RoleKey[] = validateAllowedRoleKeys(
  rawConfig.allowedRoleKeys,
  'config.pingSkillRole.allowedRoleKeys',
  '/ping-skill-role',
)
