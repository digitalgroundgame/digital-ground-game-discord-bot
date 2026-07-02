import { Collection, type Guild, type GuildMember, type Role } from 'discord.js'
import { describe, expect, it } from 'vitest'

import { type ServerRole, ServerRoles } from '../../src/constants/index.js'
import { RoleDiscoveryService } from '../../src/services/role-discovery-service.js'

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

describe('RoleDiscoveryService', () => {
  const service = new RoleDiscoveryService()

  it('returns exactly the configured roles the member holds, as a flat list', () => {
    const admin = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const director = createRole(ServerRoles.DIRECTOR.id, ServerRoles.DIRECTOR.name)
    const unrelated = createRole('some-other-role', 'Some Other Role')
    const member = createMember([admin, director, unrelated], [admin, director, unrelated])

    const active = service.getActiveRoles(member)

    expect(active.map((role) => role.key).sort()).toEqual(['ADMIN', 'DIRECTOR'])
    expect(active).toContainEqual({ key: 'ADMIN', ...ServerRoles.ADMIN })
    expect(active).toContainEqual({ key: 'DIRECTOR', ...ServerRoles.DIRECTOR })
  })

  it('discovers a role held by configured name when the configured id is absent', () => {
    const localAdmin = createRole('local-admin-role', ServerRoles.ADMIN.name)
    const member = createMember([localAdmin], [localAdmin])

    expect(service.getActiveRoleKeys(member)).toEqual(['ADMIN'])
  })

  it('returns an empty list when the member holds no configured roles', () => {
    const unrelated = createRole('some-other-role', 'Some Other Role')
    const member = createMember([unrelated], [unrelated])

    expect(service.getActiveRoles(member)).toEqual([])
  })

  it('scopes discovery to an injected catalog', () => {
    const catalog = { ADMIN: ServerRoles.ADMIN } as Record<'ADMIN', ServerRole>
    const scoped = new RoleDiscoveryService(catalog as unknown as typeof ServerRoles)
    const admin = createRole(ServerRoles.ADMIN.id, ServerRoles.ADMIN.name)
    const director = createRole(ServerRoles.DIRECTOR.id, ServerRoles.DIRECTOR.name)
    const member = createMember([admin, director], [admin, director])

    expect(scoped.getActiveRoleKeys(member)).toEqual(['ADMIN'])
  })
})
