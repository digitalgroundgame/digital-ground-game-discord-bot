import { type Guild, type GuildMember, type Role } from 'discord.js'

import { getRoleById } from '../constants/index.js'

export class RoleUtils {
  public static findConfiguredRole(guild: Guild, roleId: string): Role | undefined {
    const role = guild.roles.cache.get(roleId)
    if (role) return role

    const configuredRole = getRoleById(roleId)
    if (!configuredRole) return undefined

    return guild.roles.cache.find((guildRole) => guildRole.name === configuredRole.name)
  }

  public static memberHasConfiguredRole(member: GuildMember, roleId: string): boolean {
    if (member.roles.cache.has(roleId)) return true

    const role = this.findConfiguredRole(member.guild, roleId)
    if (!role || role.id === roleId) return false

    return member.roles.cache.has(role.id)
  }

  public static memberHasAnyConfiguredRole(member: GuildMember, roleIds: string[]): boolean {
    return roleIds.some((roleId) => this.memberHasConfiguredRole(member, roleId))
  }
}
