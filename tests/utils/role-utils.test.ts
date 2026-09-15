import { Collection, type Guild, type GuildMember, type Role } from 'discord.js'
import { describe, expect, it } from 'vitest'

import { ServerRoles } from '../../src/constants/index.js'
import { RoleUtils } from '../../src/utils/role-utils.js'

function createRole(id: string, name: string): Role {
  return { id, name } as Role
}

function createRoleCollection(roles: Role[]): Collection<string, Role> {
  return new Collection<string, Role>(roles.map((role) => [role.id, role]))
}

function createMember(memberRoles: Role[], guildRoles: Role[]): GuildMember {
  const guild = {
    roles: {
      cache: createRoleCollection(guildRoles),
    },
  } as Guild

  return {
    guild,
    roles: {
      cache: createRoleCollection(memberRoles),
    },
  } as GuildMember
}

describe('RoleUtils', () => {
  it('finds a configured role by ID first', () => {
    const configuredRole = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const sameNamedRole = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const guild = createMember([], [sameNamedRole, configuredRole]).guild

    expect(RoleUtils.findConfiguredRole(guild, ServerRoles.ADMIN.id)).toBe(configuredRole)
  })

  it('falls back to the configured role name when the configured ID is absent', () => {
    const localRole = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const guild = createMember([], [localRole]).guild

    expect(RoleUtils.findConfiguredRole(guild, ServerRoles.ADMIN.id)).toBe(localRole)
  })

  it('passes membership by configured ID', () => {
    const configuredRole = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const member = createMember([configuredRole], [configuredRole])

    expect(RoleUtils.memberHasConfiguredRole(member, ServerRoles.ADMIN.id)).toBe(true)
  })

  it('passes membership by configured name only when the configured ID is absent', () => {
    const localRole = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const member = createMember([localRole], [localRole])

    expect(RoleUtils.memberHasConfiguredRole(member, ServerRoles.ADMIN.id)).toBe(true)
  })

  it('does not use the name fallback when the configured ID exists in the guild', () => {
    const configuredRole = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const sameNamedRole = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const member = createMember([sameNamedRole], [configuredRole, sameNamedRole])

    expect(RoleUtils.memberHasConfiguredRole(member, ServerRoles.ADMIN.id)).toBe(false)
  })
})
