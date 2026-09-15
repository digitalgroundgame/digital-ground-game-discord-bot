import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

export interface ServerRole {
  id: string
  name: string
}

export type RoleKey =
  | 'COORDINATOR'
  | 'TEAM_LEAD'
  | 'ORGANIZER'
  | 'DIRECTOR'
  | 'ADMIN'
  | 'WELCOME_TEAM'
  | 'WELCOME_SUPERVISOR'

export const ServerRoles: Record<RoleKey, ServerRole> = Config.roles

export function getRoleById(roleId: string): ServerRole | undefined {
  return Object.values(ServerRoles).find((role) => role.id === roleId)
}

export function getRoleNameById(roleId: string): string {
  return getRoleById(roleId)?.name ?? 'Unknown Role'
}

/**
 * Validates a config `allowedRoleKeys` list for a command that is a
 * permission boundary. Fails CLOSED: an empty, missing, or typo'd list
 * refuses to start the bot rather than silently leaving the command
 * unrestricted (an empty `requireRoles` skips the role check entirely).
 */
export function validateAllowedRoleKeys(
  raw: unknown,
  configPath: string,
  commandName: string,
): RoleKey[] {
  const keys = Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : []
  const validKeys = Object.keys(ServerRoles)

  const unknown = keys.filter((key) => !validKeys.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `${configPath} contains unknown role keys: ${unknown.join(', ')} (valid: ${validKeys.join(', ')})`,
    )
  }
  if (keys.length === 0) {
    throw new Error(
      `${configPath} must list at least one role key; an empty list would leave ${commandName} open to everyone`,
    )
  }
  return keys as RoleKey[]
}
