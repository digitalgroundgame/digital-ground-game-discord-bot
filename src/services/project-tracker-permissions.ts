import { createRequire } from 'node:module'

import { type Guild } from 'discord.js'

export const TRACKER_PERMISSION_KEYS = [
  'createProject',
  'archiveProject',
  'addMilestone',
  'addTask',
  'assignTask',
  'changeTaskStatus',
  'view',
] as const
export type TrackerPermission = (typeof TRACKER_PERMISSION_KEYS)[number]
type PermissionConfig = Record<TrackerPermission, string[]>

const require = createRequire(import.meta.url)
const Config = require('../../config/tracker-permissions.json') as Partial<PermissionConfig>

const DEFAULT_CONFIG: PermissionConfig = {
  createProject: [],
  archiveProject: [],
  addMilestone: [],
  addTask: [],
  assignTask: [],
  changeTaskStatus: [],
  view: [],
}

function cleanConfig(config: Partial<PermissionConfig>): PermissionConfig {
  return Object.fromEntries(
    TRACKER_PERMISSION_KEYS.map((key) => [
      key,
      Array.isArray(config[key])
        ? config[key]!.filter(
            (role): role is string => typeof role === 'string' && role.trim() !== '',
          )
        : DEFAULT_CONFIG[key],
    ]),
  ) as PermissionConfig
}

export class ProjectTrackerPermissions {
  private readonly config = cleanConfig(Config)

  public allowedRoles(permission: TrackerPermission): string[] {
    return [...this.config[permission]]
  }

  public async can(guild: Guild, userId: string, permission: TrackerPermission): Promise<boolean> {
    const roleNames = this.config[permission]
    if (roleNames.length === 0) return true

    try {
      const member = await guild.members.fetch(userId)
      return roleNames.some((roleName) => member.roles.cache.some((role) => role.name === roleName))
    } catch {
      return false
    }
  }

  public deniedMessage(permission: TrackerPermission): string {
    const roles = this.config[permission]
    return roles.length
      ? `Permission denied. You need one of these roles: ${roles.map((role) => `**${role}**`).join(', ')}.`
      : 'Permission denied.'
  }
}
