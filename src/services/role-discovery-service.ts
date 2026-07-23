import { type GuildMember } from 'discord.js'

import { type RoleKey, type ServerRole, ServerRoles } from '../constants/index.js'
import { RoleUtils } from '../utils/role-utils.js'

/** A pre-defined role a member was found to actively hold, carrying its config key. */
export type DiscoveredRole = ServerRole & { key: RoleKey }

/**
 * Exposes which of the pre-defined roles (see `config.roles` / `ServerRoles`) a
 * given member actively holds.
 *
 * Stateless: it reads only the passed-in member and the role catalog, delegating
 * membership checks to {@link RoleUtils.memberHasConfiguredRole} so the id-first /
 * name-fallback behavior is preserved.
 */
export class RoleDiscoveryService {
  constructor(private readonly roles: Record<RoleKey, ServerRole> = ServerRoles) {}

  /** The pre-defined roles `member` actively holds, as a flat list. */
  public getActiveRoles(member: GuildMember): DiscoveredRole[] {
    return (Object.entries(this.roles) as [RoleKey, ServerRole][])
      .filter(([, role]) => RoleUtils.memberHasConfiguredRole(member, role.id))
      .map(([key, role]) => ({ key, ...role }))
  }

  /** The config keys of the pre-defined roles `member` actively holds. */
  public getActiveRoleKeys(member: GuildMember): RoleKey[] {
    return this.getActiveRoles(member).map((role) => role.key)
  }
}
