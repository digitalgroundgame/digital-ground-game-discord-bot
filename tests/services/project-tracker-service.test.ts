import { beforeEach, describe, expect, it } from 'vitest'

import { ProjectTrackerService } from '../../src/services/project-tracker-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

describe('ProjectTrackerService', () => {
  let service: ProjectTrackerService

  beforeEach(() => {
    service = new ProjectTrackerService(createTestDatabase())
  })

  it('creates a project hierarchy and computes progress', async () => {
    const project = await service.createProject('guild-a', 'Campaign', 'Description', 'owner-a')
    const milestone = await service.createMilestone('guild-a', project.id, 'Launch', '')
    const task = await service.createTask(
      'guild-a',
      project.id,
      milestone.id,
      'Publish signup form',
      'owner-a',
    )

    expect(task.status).toBe('todo')
    expect((await service.getSummary('guild-a', project.id))?.progress).toBe(0)

    await service.setTaskStatus('guild-a', task.id, 'done')
    const summary = await service.getSummary('guild-a', project.id)
    expect(summary?.completedTasks).toBe(1)
    expect(summary?.progress).toBe(100)
  })

  it('rejects cross-guild and cross-project relationships', async () => {
    const project = await service.createProject('guild-a', 'Campaign', '', 'owner-a')
    const otherProject = await service.createProject('guild-a', 'Other', '', 'owner-a')
    const milestone = await service.createMilestone('guild-a', project.id, 'Launch', '')

    await expect(service.createMilestone('guild-b', project.id, 'Wrong guild', '')).rejects.toThrow(
      'Project not found',
    )
    await expect(
      service.createTask('guild-a', otherProject.id, milestone.id, 'Wrong project'),
    ).rejects.toThrow('Project and milestone do not match')
  })

  it('archives projects without deleting their work and hides them from active views', async () => {
    const service = new ProjectTrackerService(createTestDatabase())
    const project = await service.createProject('guild-a', 'Archive me', '', 'owner-a')
    await service.createMilestone('guild-a', project.id, 'Keep this milestone', '')

    const archived = await service.setProjectStatus('guild-a', project.id, 'archived')

    expect(archived?.status).toBe('archived')
    expect(await service.listProjects('guild-a')).toEqual([])
    expect(await service.listProjects('guild-a', true)).toHaveLength(1)
    expect((await service.getSummary('guild-a', project.id))?.milestones).toHaveLength(1)
  })

  it('makes archived projects read-only', async () => {
    const project = await service.createProject('guild-a', 'Read only', '', 'owner-a')
    const milestone = await service.createMilestone('guild-a', project.id, 'Stage', '')
    const task = await service.createTask('guild-a', project.id, milestone.id, 'Task')
    await service.setProjectStatus('guild-a', project.id, 'archived')

    await expect(service.createMilestone('guild-a', project.id, 'Blocked', '')).rejects.toThrow(
      'Project is archived',
    )
    await expect(
      service.createTask('guild-a', project.id, milestone.id, 'Blocked'),
    ).rejects.toThrow('Project and milestone do not match')
    await expect(service.setTaskStatus('guild-a', task.id, 'done')).resolves.toBeUndefined()
    await expect(service.assignTask('guild-a', task.id, 'member-a')).resolves.toBeUndefined()
  })

  it('validates required fields and limits', async () => {
    await expect(service.createProject('guild-a', '  ', '', 'owner-a')).rejects.toThrow(
      'Project name is required',
    )
    await expect(service.createProject('guild-a', 'x'.repeat(101), '', 'owner-a')).rejects.toThrow(
      'Project name is too long',
    )
  })

  it('creates guided setup atomically', async () => {
    const result = await service.createGuidedProject(
      'guild-a',
      'Campaign',
      'Description',
      'Launch',
      'Publish signup form',
      'owner-a',
    )

    expect(result.project.name).toBe('Campaign')
    expect(result.milestone.projectId).toBe(result.project.id)
    expect(result.task.milestoneId).toBe(result.milestone.id)
    expect(result.task.assigneeId).toBe('owner-a')
  })
})
