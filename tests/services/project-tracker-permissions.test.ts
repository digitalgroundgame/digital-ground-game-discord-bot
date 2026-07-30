import { Collection, type Guild, type Role } from 'discord.js'
import { describe, expect, it, vi } from 'vitest'

import { ProjectTrackerPermissions } from '../../src/services/project-tracker-permissions.js'

describe('ProjectTrackerPermissions', () => {
  it('loads the mock test-server policy by role name', () => {
    const permissions = new ProjectTrackerPermissions()

    expect(permissions.allowedRoles('createProject')).toEqual(['Above All', 'King Froggo'])
    expect(permissions.allowedRoles('addTask')).toContain('Below All')
    expect(permissions.allowedRoles('view')).toEqual([])
  })

  it('allows matching roles and denies non-matching roles', async () => {
    const permissions = new ProjectTrackerPermissions()
    const roles = new Collection<string, Role>([['role-1', { name: 'King Froggo' } as Role]])
    const guild = {
      members: { fetch: vi.fn().mockResolvedValue({ roles: { cache: roles } }) },
    } as unknown as Guild

    await expect(permissions.can(guild, 'user-1', 'createProject')).resolves.toBe(true)
    await expect(permissions.can(guild, 'user-1', 'assignTask')).resolves.toBe(true)

    roles.clear()
    roles.set('role-2', { name: 'Below All' } as Role)
    await expect(permissions.can(guild, 'user-1', 'assignTask')).resolves.toBe(false)
    await expect(permissions.can(guild, 'user-1', 'addTask')).resolves.toBe(true)
  })
})
