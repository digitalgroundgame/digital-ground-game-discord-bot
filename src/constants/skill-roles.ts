import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface PingSkillRoleConfig {
  allowedRoleKeys: string[]
}

const rawConfig = (Config.pingSkillRole ?? {}) as Partial<PingSkillRoleConfig>

/** Role config keys (see `config.roles`) allowed to run `/ping-skill-role`. */
export const PingSkillRoleAllowedRoleKeys: string[] = Array.isArray(rawConfig.allowedRoleKeys)
  ? rawConfig.allowedRoleKeys
  : []
