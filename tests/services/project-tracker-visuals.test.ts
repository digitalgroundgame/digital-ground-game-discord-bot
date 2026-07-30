import { describe, expect, it, vi } from 'vitest'

import { ProjectTrackerPanelButtons } from '../../src/buttons/project-tracker-panel-buttons.js'
import { type ButtonInteraction } from 'discord.js'
import { type TrackerTaskStatus } from '../../src/database/schema.js'
import { ProjectTrackerPanelMenus } from '../../src/select-menus/project-tracker-panel-menus.js'
import { ProjectTrackerService } from '../../src/services/project-tracker-service.js'
import {
  buildProjectTrackerPanel,
  buildProjectTrackerTree,
} from '../../src/services/project-tracker-panel.js'
import {
  renderProjectCard,
  renderTaskCard,
  renderTrackerConfirmation,
  renderTrackerDashboard,
  renderTrackerGuide,
} from '../../src/services/project-tracker-visuals.js'
import { createTestDatabase } from '../helpers/test-database.js'
import { InteractionUtils } from '../../src/utils/index.js'

function expectPng(attachment: { attachment: unknown }): void {
  expect(Buffer.isBuffer(attachment.attachment)).toBe(true)
  expect((attachment.attachment as Buffer).subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
}

describe('project tracker visual views', () => {
  it('renders a PNG for each tracker view and attaches one to the panel', async () => {
    const service = new ProjectTrackerService(createTestDatabase())
    const project = await service.createProject('guild-a', 'Visual MVP', '', 'owner-a')
    const milestone = await service.createMilestone('guild-a', project.id, 'Design', '')
    const task = await service.createTask('guild-a', project.id, milestone.id, 'Make a dashboard')
    const assignedTask = await service.createTask(
      'guild-a',
      project.id,
      milestone.id,
      'Review the dashboard',
      'member-a',
    )
    await service.setTaskStatus('guild-a', assignedTask.id, 'done')
    const summary = await service.getSummary('guild-a', project.id)
    if (!summary) throw new Error('Expected summary')

    expectPng(renderTrackerDashboard([]))
    expectPng(renderTrackerDashboard([summary]))
    expectPng(renderProjectCard(summary, new Map([['member-a', 'Bevin']])))
    expectPng(renderTaskCard(task, project.name, milestone.name))
    expectPng(renderTrackerGuide())
    expectPng(renderTrackerConfirmation('Task added', '#1 Make a dashboard'))

    const panel = await buildProjectTrackerPanel(service, 'guild-a')
    expect(panel.files).toHaveLength(1)
    expectPng(panel.files?.[0] as { attachment: unknown })

    const tree = await buildProjectTrackerTree(service, 'guild-a', project.id, 'doing')
    expect(tree.files).toHaveLength(1)
    expectPng(tree.files?.[0] as { attachment: unknown })
    expect(tree.components).toHaveLength(3)

    const malformedTree = await buildProjectTrackerTree(
      service,
      'guild-a',
      Number.NaN,
      'not-a-status' as TrackerTaskStatus,
    )
    expect(malformedTree.files).toHaveLength(1)
    expectPng(malformedTree.files?.[0] as { attachment: unknown })
  })

  it('keeps the PNG attachment when refreshing an existing panel', async () => {
    const service = new ProjectTrackerService(createTestDatabase())
    const update = vi.spyOn(InteractionUtils, 'update').mockResolvedValue(null)
    const interaction = {
      guild: { id: 'guild-a' },
      user: { id: 'owner-a', bot: false },
      customId: 'tracker-panel:refresh',
    } as unknown as ButtonInteraction

    await new ProjectTrackerPanelButtons(service).execute(interaction)

    expect(update).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ files: expect.arrayContaining([expect.anything()]) }),
    )
    update.mockRestore()
  })

  it('opens task actions from a task id/name dropdown selection', async () => {
    const service = new ProjectTrackerService(createTestDatabase())
    const project = await service.createProject('guild-a', 'Actions', '', 'owner-a')
    const milestone = await service.createMilestone('guild-a', project.id, 'Stage', '')
    const task = await service.createTask('guild-a', project.id, milestone.id, 'Review assignment')
    const send = vi.spyOn(InteractionUtils, 'send').mockResolvedValue(null)
    const interaction = {
      guildId: 'guild-a',
      customId: 'tracker-panel:select-task',
      values: [String(task.id)],
    } as unknown as import('discord.js').StringSelectMenuInteraction

    await new ProjectTrackerPanelMenus(service).execute(interaction)

    expect(send).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ components: expect.any(Array) }),
      true,
    )
    send.mockRestore()
  })
})
