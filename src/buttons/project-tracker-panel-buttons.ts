import {
  type ButtonInteraction,
  type ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'

import { type Button, ButtonDeferType } from './index.js'
import {
  ProjectTrackerPermissions,
  type ProjectTrackerService,
  type TrackerPermission,
} from '../services/index.js'
import {
  buildProjectTrackerHelp,
  buildProjectTrackerPanel,
  buildProjectTrackerTree,
} from '../services/project-tracker-panel.js'
import { renderTrackerConfirmation } from '../services/project-tracker-visuals.js'
import { renderTaskCard } from '../services/project-tracker-visuals.js'
import { TRACKER_TASK_STATUSES } from '../database/schema.js'
import { InteractionUtils } from '../utils/index.js'

function modal(
  id: string,
  title: string,
  fields: Array<{ id: string; label: string; required?: boolean }>,
): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(id)
    .setTitle(title)
    .addComponents(
      fields.map((field) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(TextInputStyle.Short)
            .setRequired(field.required ?? true)
            .setMaxLength(200),
        ),
      ),
    )
}

function safeTaskId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

async function collect(
  intr: ButtonInteraction,
  builder: ModalBuilder,
  modalId: string,
): Promise<ModalSubmitInteraction | undefined> {
  await intr.showModal(builder)
  try {
    return await intr.awaitModalSubmit({
      filter: (submit) => submit.customId === modalId && submit.user.id === intr.user.id,
      time: 10 * 60_000,
    })
  } catch {
    return undefined
  }
}

export class ProjectTrackerPanelButtons implements Button {
  public ids = [
    'tracker-panel:refresh',
    'tracker-panel:create-project',
    'tracker-panel:guided-setup',
    'tracker-panel:help',
    'tracker-panel:add-milestone',
    'tracker-panel:add-task',
    'tracker-panel:complete-task',
    'tracker-panel:tree',
    'tracker-panel:overview',
    'tracker-task:inspect',
    'tracker-task:status',
    'tracker-task:assign',
    'tracker-project:archive',
    'tracker-project:unarchive',
  ]
  public requireGuild = true
  public requireEmbedAuthorTag = false

  constructor(
    private readonly service: ProjectTrackerService,
    private readonly permissions = new ProjectTrackerPermissions(),
  ) {}

  public deferType = ButtonDeferType.NONE

  public async execute(intr: ButtonInteraction): Promise<void> {
    if (!intr.guild) return
    if (!(await this.permissions.can(intr.guild, intr.user.id, 'view')))
      return void (await InteractionUtils.send(intr, this.permissions.deniedMessage('view'), true))
    if (intr.customId.startsWith('tracker-project:')) {
      const [, action, rawProjectId] = intr.customId.split(':')
      const projectId = safeTaskId(rawProjectId)
      if (!['archive', 'unarchive'].includes(action ?? '') || !projectId)
        return void (await InteractionUtils.send(intr, 'That project selection is invalid.', true))
      if (!(await this.permissions.can(intr.guild, intr.user.id, 'archiveProject')))
        return void (await InteractionUtils.send(
          intr,
          this.permissions.deniedMessage('archiveProject'),
          true,
        ))
      const nextStatus = action === 'archive' ? 'archived' : 'active'
      const project = await this.service.setProjectStatus(intr.guild.id, projectId, nextStatus)
      if (!project)
        return void (await InteractionUtils.send(
          intr,
          'That project is no longer available.',
          true,
        ))
      await InteractionUtils.send(
        intr,
        action === 'archive'
          ? `Archived **${project.name}**. It is hidden from the overview, project briefs, and project tree.`
          : `Unarchived **${project.name}**. It is visible in the active tracker views again.`,
        true,
      )
      return
    }
    if (intr.customId.startsWith('tracker-task:')) {
      const [, action, rawTaskId] = intr.customId.split(':')
      const taskId = safeTaskId(rawTaskId)
      if (!taskId)
        return void (await InteractionUtils.send(intr, 'That task selection is invalid.', true))
      const task = await this.service.getTask(intr.guild.id, taskId)
      if (!task)
        return void (await InteractionUtils.send(intr, 'That task is no longer available.', true))
      const summary = await this.service.getSummary(intr.guild.id, task.projectId)
      const milestoneName = summary?.milestones.find(
        (group) => group.milestone.id === task.milestoneId,
      )?.milestone.name
      if (action === 'inspect') {
        const image = renderTaskCard(task, summary?.project.name, milestoneName)
        return void (await InteractionUtils.send(
          intr,
          {
            embeds: [
              {
                color: task.status === 'blocked' ? 0xea6b70 : 0x0090ff,
                title: `Task brief · #${task.id}`,
                description: task.assigneeId
                  ? `Assigned to <@${task.assigneeId}>.`
                  : 'Unassigned task.',
                image: { url: `attachment://dgg-task-${task.id}.png` },
              },
            ],
            files: [image],
          },
          true,
        ))
      }
      if (action === 'status') {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`tracker-task-status:${task.id}`)
          .setPlaceholder('Choose the new task status')
          .addOptions(
            TRACKER_TASK_STATUSES.map((status) => ({
              label:
                status === 'doing'
                  ? 'In progress'
                  : status.charAt(0).toUpperCase() + status.slice(1),
              value: status,
              description: `Set task #${task.id} to ${status}`,
              default: task.status === status,
            })),
          )
        return void (await InteractionUtils.send(
          intr,
          {
            content: `Update **#${task.id} ${task.title}**`,
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
          },
          true,
        ))
      }
      if (action === 'assign') {
        const members = [...intr.guild.members.cache.values()]
          .filter((member) => !member.user.bot)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .slice(0, 24)
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`tracker-task-assignee:${task.id}`)
          .setPlaceholder('Choose an assignee')
          .addOptions(
            [
              { label: 'Unassign task', value: 'none', description: 'Remove the current assignee' },
              ...members.map((member) => ({
                label: member.displayName.slice(0, 100),
                value: member.id,
                description: member.user.tag.slice(0, 100),
                default: task.assigneeId === member.id,
              })),
            ].slice(0, 25),
          )
        return void (await InteractionUtils.send(
          intr,
          {
            content: `Assign **#${task.id} ${task.title}**`,
            components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
          },
          true,
        ))
      }
      return
    }
    if (intr.customId === 'tracker-panel:tree') {
      const tree = await buildProjectTrackerTree(this.service, intr.guild.id)
      await InteractionUtils.update(intr, {
        embeds: tree.embeds,
        components: tree.components,
        files: tree.files,
      })
      return
    }
    if (intr.customId === 'tracker-panel:overview') {
      const panel = await buildProjectTrackerPanel(this.service, intr.guild.id)
      await InteractionUtils.update(intr, {
        embeds: panel.embeds,
        components: panel.components,
        files: panel.files,
      })
      return
    }
    if (intr.customId === 'tracker-panel:refresh') {
      const panel = await buildProjectTrackerPanel(this.service, intr.guild.id)
      await InteractionUtils.update(intr, {
        embeds: panel.embeds,
        components: panel.components,
        files: panel.files,
      })
      return
    }
    if (intr.customId === 'tracker-panel:help') {
      await InteractionUtils.send(intr, await buildProjectTrackerHelp(), true)
      return
    }

    const definitions: Record<
      string,
      { title: string; fields: Array<{ id: string; label: string; required?: boolean }> }
    > = {
      'tracker-panel:create-project': {
        title: 'Create project',
        fields: [
          { id: 'name', label: 'Project name' },
          { id: 'description', label: 'Description', required: false },
        ],
      },
      'tracker-panel:guided-setup': {
        title: 'Guided project setup',
        fields: [
          { id: 'name', label: 'Project name' },
          { id: 'description', label: 'Description', required: false },
          { id: 'milestone', label: 'First milestone' },
          { id: 'title', label: 'First task' },
        ],
      },
      'tracker-panel:add-milestone': {
        title: 'Add milestone',
        fields: [
          { id: 'project', label: 'Project name' },
          { id: 'name', label: 'Milestone name' },
        ],
      },
      'tracker-panel:add-task': {
        title: 'Add task',
        fields: [
          { id: 'project', label: 'Project name' },
          { id: 'milestone', label: 'Milestone name' },
          { id: 'title', label: 'Task title' },
        ],
      },
      'tracker-panel:complete-task': {
        title: 'Complete task',
        fields: [{ id: 'task_id', label: 'Task number' }],
      },
    }
    const definition = definitions[intr.customId]
    if (!definition) return
    const permission: TrackerPermission =
      intr.customId === 'tracker-panel:create-project' ||
      intr.customId === 'tracker-panel:guided-setup'
        ? 'createProject'
        : intr.customId === 'tracker-panel:add-milestone'
          ? 'addMilestone'
          : intr.customId === 'tracker-panel:add-task'
            ? 'addTask'
            : 'changeTaskStatus'
    if (!(await this.permissions.can(intr.guild, intr.user.id, permission))) {
      await InteractionUtils.send(intr, this.permissions.deniedMessage(permission), true)
      return
    }
    const modalId = `tracker-panel-modal:${intr.customId}:${intr.id}`
    const submit = await collect(intr, modal(modalId, definition.title, definition.fields), modalId)
    if (!submit) return
    await this.handleSubmit(submit)
  }

  private async handleSubmit(submit: ModalSubmitInteraction): Promise<void> {
    const value = (id: string) => submit.fields.getTextInputValue(id).trim()
    try {
      if (!submit.guildId) {
        await InteractionUtils.send(submit, 'This action can only be used in a server.', true)
        return
      }
      const action = submit.customId.split(':')[2]
      const permission: TrackerPermission =
        action === 'create-project' || action === 'guided-setup'
          ? 'createProject'
          : action === 'add-milestone'
            ? 'addMilestone'
            : action === 'add-task'
              ? 'addTask'
              : 'changeTaskStatus'
      if (
        !submit.guild ||
        !(await this.permissions.can(submit.guild, submit.user.id, permission))
      ) {
        await InteractionUtils.send(submit, this.permissions.deniedMessage(permission), true)
        return
      }
      let confirmation: [string, string]
      switch (action) {
        case 'create-project': {
          const project = await this.service.createProject(
            submit.guildId,
            value('name'),
            value('description'),
            submit.user.id,
          )
          confirmation = ['Project created', project.name]
          break
        }
        case 'guided-setup': {
          const result = await this.service.createGuidedProject(
            submit.guildId,
            value('name'),
            value('description'),
            value('milestone'),
            value('title'),
            submit.user.id,
          )
          confirmation = ['Project ready', `${result.project.name} is ready for work`]
          break
        }
        case 'add-milestone': {
          const project = await this.service.findProject(submit.guildId, value('project'))
          if (!project) throw new Error('Project not found')
          const milestone = await this.service.createMilestone(
            submit.guildId,
            project.id,
            value('name'),
            '',
          )
          confirmation = ['Milestone added', milestone.name]
          break
        }
        case 'add-task': {
          const project = await this.service.findProject(submit.guildId, value('project'))
          if (!project) throw new Error('Project not found')
          const milestone = await this.service.findMilestone(
            submit.guildId,
            project.id,
            value('milestone'),
          )
          if (!milestone) throw new Error('Milestone not found')
          const task = await this.service.createTask(
            submit.guildId,
            project.id,
            milestone.id,
            value('title'),
            submit.user.id,
          )
          confirmation = ['Task added', `#${task.id} ${task.title}`]
          break
        }
        case 'complete-task': {
          const taskId = safeTaskId(value('task_id'))
          if (!taskId) throw new Error('Invalid task')
          const task = await this.service.setTaskStatus(submit.guildId, taskId, 'done')
          if (!task) throw new Error('Task not found')
          confirmation = ['Task completed', `#${task.id} ${task.title}`]
          break
        }
        default:
          throw new Error('Unknown panel action')
      }
      const image = renderTrackerConfirmation(...confirmation)
      await InteractionUtils.send(
        submit,
        {
          embeds: [
            {
              color: 0x42c487,
              title: confirmation[0],
              description: `${confirmation[1]}\n\nClick **Refresh overview** on the panel to update the shared image.`,
              image: { url: 'attachment://dgg-tracker-update.png' },
            },
          ],
          files: [image],
        },
        true,
      )
    } catch {
      await InteractionUtils.send(submit, 'That action could not be completed.', true)
    }
  }
}
