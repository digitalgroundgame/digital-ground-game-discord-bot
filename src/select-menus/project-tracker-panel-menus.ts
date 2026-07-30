import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js'

import { SelectMenuDeferType, type SelectMenu } from './index.js'
import { TRACKER_TASK_STATUSES, type TrackerTaskStatus } from '../database/schema.js'
import { ProjectTrackerPermissions } from '../services/project-tracker-permissions.js'
import { buildProjectTrackerTree } from '../services/project-tracker-panel.js'
import { type ProjectTrackerService } from '../services/project-tracker-service.js'
import { renderProjectCard } from '../services/project-tracker-visuals.js'
import { renderTrackerConfirmation } from '../services/project-tracker-visuals.js'
import { InteractionUtils } from '../utils/index.js'

function safeProjectId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

function safeTaskId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

export class ProjectTrackerPanelMenus implements SelectMenu {
  public ids = [
    'tracker-panel:select-project',
    'tracker-panel:select-task',
    'tracker-tree:project',
    'tracker-tree:status',
    'tracker-task-status',
    'tracker-task-assignee',
    'tracker-project:list-select',
  ]
  public deferType = SelectMenuDeferType.NONE
  public requireGuild = true

  constructor(
    private readonly service: ProjectTrackerService,
    private readonly permissions = new ProjectTrackerPermissions(),
  ) {}

  public async execute(intr: StringSelectMenuInteraction): Promise<void> {
    if (!intr.guildId) return
    if (intr.guild && !(await this.permissions.can(intr.guild, intr.user.id, 'view')))
      return void (await InteractionUtils.send(intr, this.permissions.deniedMessage('view'), true))
    const selected = intr.values[0]
    if (!selected) return
    if (intr.customId === 'tracker-project:list-select') {
      const projectId = safeProjectId(selected)
      const project = projectId && (await this.service.findProjectById(intr.guildId, projectId))
      if (!project)
        return void (await InteractionUtils.send(
          intr,
          'That project is no longer available.',
          true,
        ))
      const action = new ButtonBuilder()
        .setCustomId(
          `tracker-project:${project.status === 'archived' ? 'unarchive' : 'archive'}:${project.id}`,
        )
        .setLabel(project.status === 'archived' ? 'Unarchive project' : 'Archive project')
        .setStyle(project.status === 'archived' ? ButtonStyle.Success : ButtonStyle.Danger)
      await InteractionUtils.send(
        intr,
        {
          content: `**${project.name}** is currently **${project.status}**.`,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(action)],
        },
        true,
      )
      return
    }
    if (intr.customId.startsWith('tracker-tree:')) {
      const [, filter, carried] = intr.customId.split(':')
      const currentStatus =
        filter === 'project' && carried !== 'all' ? (carried as TrackerTaskStatus) : undefined
      const currentProject =
        filter === 'status' && carried && carried !== 'all' ? safeProjectId(carried) : undefined
      const nextProject =
        filter === 'project' && selected !== 'all' ? safeProjectId(selected) : currentProject
      const nextStatus =
        filter === 'status' && selected !== 'all' ? (selected as TrackerTaskStatus) : currentStatus
      const tree = await buildProjectTrackerTree(
        this.service,
        intr.guildId,
        nextProject,
        nextStatus,
      )
      await InteractionUtils.update(intr, {
        embeds: tree.embeds,
        components: tree.components,
        files: tree.files,
      })
      return
    }
    if (intr.customId.startsWith('tracker-task-status:')) {
      const taskId = safeTaskId(intr.customId.split(':')[1])
      const nextValue = intr.values[0]
      const next = TRACKER_TASK_STATUSES.includes(nextValue as TrackerTaskStatus)
        ? (nextValue as TrackerTaskStatus)
        : undefined
      if (!taskId || !next)
        return void (await InteractionUtils.send(
          intr,
          'That task status selection is invalid.',
          true,
        ))
      if (
        !intr.guild ||
        !(await this.permissions.can(intr.guild, intr.user.id, 'changeTaskStatus'))
      )
        return void (await InteractionUtils.send(
          intr,
          this.permissions.deniedMessage('changeTaskStatus'),
          true,
        ))
      const task = await this.service.setTaskStatus(intr.guildId, taskId, next)
      if (!task)
        return void (await InteractionUtils.send(intr, 'That task is no longer available.', true))
      const image = renderTrackerConfirmation(
        'Task updated',
        `#${task.id} ${task.title} · ${task.status}`,
      )
      return void (await InteractionUtils.send(
        intr,
        {
          embeds: [
            {
              title: 'Task updated',
              description: `Task #${task.id} is now **${task.status}**.`,
              color: 0x42c487,
              image: { url: 'attachment://dgg-tracker-update.png' },
            },
          ],
          files: [image],
        },
        true,
      ))
    }
    if (intr.customId.startsWith('tracker-task-assignee:')) {
      const taskId = safeTaskId(intr.customId.split(':')[1])
      const assigneeId = intr.values[0] === 'none' ? undefined : intr.values[0]
      if (!taskId || (!assigneeId && intr.values[0] !== 'none'))
        return void (await InteractionUtils.send(intr, 'That assignee selection is invalid.', true))
      if (!intr.guild || !(await this.permissions.can(intr.guild, intr.user.id, 'assignTask')))
        return void (await InteractionUtils.send(
          intr,
          this.permissions.deniedMessage('assignTask'),
          true,
        ))
      const task = await this.service.assignTask(intr.guildId, taskId, assigneeId)
      if (!task)
        return void (await InteractionUtils.send(intr, 'That task is no longer available.', true))
      const detail = task.assigneeId
        ? `#${task.id} assigned to <@${task.assigneeId}>`
        : `#${task.id} is unassigned`
      const image = renderTrackerConfirmation('Assignment updated', detail)
      return void (await InteractionUtils.send(
        intr,
        {
          embeds: [
            {
              title: 'Assignment updated',
              description: detail,
              color: 0x42c487,
              image: { url: 'attachment://dgg-tracker-update.png' },
            },
          ],
          files: [image],
        },
        true,
      ))
    }
    if (intr.customId === 'tracker-panel:select-project') {
      const project = await this.service.findProject(intr.guildId, selected)
      const summary = project && (await this.service.getSummary(intr.guildId, project.id))
      if (!project || !summary) {
        await InteractionUtils.send(intr, 'That project is no longer available.', true)
        return
      }
      const assigneeNames = new Map<string, string>()
      const assigneeIds = [
        ...new Set(
          summary.tasks.map((task) => task.assigneeId).filter((id): id is string => Boolean(id)),
        ),
      ]
      await Promise.all(
        assigneeIds.map(async (id) => {
          const member =
            intr.guild?.members.cache.get(id) ??
            (intr.guild ? await intr.guild.members.fetch(id).catch(() => null) : null)
          assigneeNames.set(id, member?.user.username ?? id)
        }),
      )
      const image = renderProjectCard(summary, assigneeNames)
      const embed = new EmbedBuilder()
        .setColor(0x0090ff)
        .setTitle(`Project brief · ${project.name}`)
        .setDescription(project.description || 'No project description yet.')
        .setImage(`attachment://dgg-project-${project.id}.png`)
        .setFooter({ text: 'Use the panel to add milestones or tasks, then refresh the overview.' })
      const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`tracker-project:archive:${project.id}`)
          .setLabel('Archive project')
          .setStyle(ButtonStyle.Danger),
      )
      await InteractionUtils.send(
        intr,
        { embeds: [embed], components: [actions], files: [image] },
        true,
      )
      return
    }

    const taskId = safeTaskId(selected)
    if (!taskId) {
      await InteractionUtils.send(intr, 'That task selection is invalid.', true)
      return
    }
    const task = await this.service.getTask(intr.guildId, taskId)
    if (!task) {
      await InteractionUtils.send(intr, 'That task is no longer available.', true)
      return
    }
    const embed = new EmbedBuilder()
      .setColor(0x0090ff)
      .setTitle(`Task actions · #${task.id}`)
      .setDescription(
        `${task.title}\n\nChoose an action below. You will get a dropdown for status or assignee selection.`,
      )
    const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tracker-task:inspect:${task.id}`)
        .setLabel('Inspect')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tracker-task:status:${task.id}`)
        .setLabel('Update status')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`tracker-task:assign:${task.id}`)
        .setLabel('Assign task')
        .setStyle(ButtonStyle.Primary),
    )
    await InteractionUtils.send(intr, { embeds: [embed], components: [actions] }, true)
  }
}
