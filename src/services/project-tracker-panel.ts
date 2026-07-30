import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type InteractionReplyOptions,
} from 'discord.js'

import { ProjectTrackerService } from './project-tracker-service.js'
import { TRACKER_TASK_STATUSES, type TrackerTaskStatus } from '../database/schema.js'
import {
  renderTrackerDashboard,
  renderTrackerGuide,
  renderTrackerTree,
} from './project-tracker-visuals.js'

function validStatus(value: unknown): TrackerTaskStatus | undefined {
  return typeof value === 'string' && TRACKER_TASK_STATUSES.includes(value as TrackerTaskStatus)
    ? (value as TrackerTaskStatus)
    : undefined
}

export async function buildProjectTrackerHelp(): Promise<InteractionReplyOptions> {
  const image = renderTrackerGuide()
  const embed = new EmbedBuilder()
    .setColor(0x0090ff)
    .setTitle('DGG Project Tracker · Quick Start')
    .setDescription(
      'Use the visual guide above, then use the panel controls below it. The workflow stays inside Discord—no slash commands required for normal use.',
    )
    .setImage('attachment://dgg-project-tracker-guide.png')
    .setFooter({ text: 'Project → milestone → task. Refresh the panel after a change.' })
  return { embeds: [embed], files: [image] }
}

export async function buildProjectTrackerPanel(
  service: ProjectTrackerService,
  guildId: string,
): Promise<InteractionReplyOptions> {
  const summaries = await service.getGuildSummaries(guildId, 25)
  const allTasks = summaries.flatMap((summary) => summary.tasks)
  const completed = allTasks.filter((task) => task.status === 'done').length
  const blocked = allTasks.filter((task) => task.status === 'blocked').length
  const image = renderTrackerDashboard(summaries)
  const embed = new EmbedBuilder()
    .setColor(blocked ? 0xf2b84b : 0x0090ff)
    .setTitle('Digital Ground Game · Project Tracker')
    .setDescription(
      summaries.length
        ? `**${summaries.length}** active project${summaries.length === 1 ? '' : 's'} · **${completed}/${allTasks.length}** tasks complete${blocked ? ` · **${blocked} blocked**` : ''}`
        : 'No projects yet. Start with **Guided setup** to create your first project, milestone, and task.',
    )
    .setImage('attachment://dgg-project-overview.png')
    .setFooter({ text: 'Use the controls below. Refresh after changes.' })

  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('tracker-panel:refresh')
      .setLabel('Refresh overview')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tracker-panel:guided-setup')
      .setLabel('Guided setup')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('tracker-panel:create-project')
      .setLabel('Create project')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('tracker-panel:help')
      .setLabel('How it works')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tracker-panel:add-milestone')
      .setLabel('Add milestone')
      .setStyle(ButtonStyle.Primary),
  )
  const tasks = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('tracker-panel:add-task')
      .setLabel('Add task')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tracker-panel:complete-task')
      .setLabel('Complete task')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tracker-panel:tree')
      .setLabel('Project tree')
      .setStyle(ButtonStyle.Secondary),
  )
  const components: Array<
    ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>
  > = [actions, tasks]
  if (summaries.length) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('tracker-panel:select-project')
          .setPlaceholder('Open a project brief')
          .addOptions(
            summaries.slice(0, 25).map((summary) => ({
              label: summary.project.name.slice(0, 100),
              value: summary.project.name,
              description: `${summary.progress}% complete · ${summary.completedTasks}/${summary.tasks.length} tasks`,
            })),
          ),
      ),
    )
    const taskOptions = summaries
      .flatMap((summary) =>
        summary.tasks.map((task) => ({
          label: `#${task.id} ${task.title}`.slice(0, 100),
          value: String(task.id),
          description: task.status,
        })),
      )
      .slice(0, 25)
    if (taskOptions.length)
      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('tracker-panel:select-task')
            .setPlaceholder('Choose a task to inspect, update, or assign')
            .addOptions(taskOptions),
        ),
      )
  }
  return { embeds: [embed], components, files: [image] }
}

export async function buildProjectTrackerTree(
  service: ProjectTrackerService,
  guildId: string,
  projectId?: number,
  status?: TrackerTaskStatus,
): Promise<InteractionReplyOptions> {
  const summaries = await service.getGuildSummaries(guildId, 25)
  const safeProjectId =
    projectId &&
    Number.isSafeInteger(projectId) &&
    projectId > 0 &&
    summaries.some((summary) => summary.project.id === projectId)
      ? projectId
      : undefined
  const safeStatus = validStatus(status)
  const image = renderTrackerTree(summaries, safeProjectId, safeStatus)
  const projectOptions = [
    {
      label: 'All projects',
      value: 'all',
      description: 'Show the complete work breakdown',
      default: !safeProjectId,
    },
    ...summaries.slice(0, 24).map((summary) => ({
      label: summary.project.name.slice(0, 100),
      value: String(summary.project.id),
      description: `${summary.progress}% complete`,
      default: summary.project.id === safeProjectId,
    })),
  ]
  const statusOptions = [
    { label: 'All statuses', value: 'all', description: 'Show every task', default: !safeStatus },
    ...TRACKER_TASK_STATUSES.map((value) => ({
      label: value === 'doing' ? 'In progress' : value.charAt(0).toUpperCase() + value.slice(1),
      value,
      description: `Show ${value} tasks`,
      default: value === safeStatus,
    })),
  ]
  const embed = new EmbedBuilder()
    .setColor(0x0090ff)
    .setTitle('Digital Ground Game · Project Tree')
    .setDescription(
      'A full visual breakdown of projects, milestones, and tasks. Use the filters to change the PNG view.',
    )
    .setImage('attachment://dgg-project-tree.png')
    .setFooter({ text: 'Filters update the tree view. Use Back to overview when finished.' })
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('tracker-panel:overview')
      .setLabel('Back to overview')
      .setStyle(ButtonStyle.Secondary),
  )
  const projectFilter = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tracker-tree:project:${safeStatus ?? 'all'}`)
      .setPlaceholder('Filter by project')
      .addOptions(projectOptions),
  )
  const statusFilter = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tracker-tree:status:${safeProjectId ?? 'all'}`)
      .setPlaceholder('Filter by task status')
      .addOptions(statusOptions),
  )
  return { embeds: [embed], components: [controls, projectFilter, statusFilter], files: [image] }
}
