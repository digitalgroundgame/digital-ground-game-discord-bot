import {
  ActionRowBuilder,
  type ApplicationCommandOptionChoiceData,
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type PermissionsString,
  StringSelectMenuBuilder,
} from 'discord.js'

import { TRACKER_TASK_STATUSES, type TrackerTaskStatus } from '../../database/schema.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  Lang,
  ProjectTrackerPermissions,
  type ProjectTrackerService,
  type TrackerPermission,
} from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { CommandDeferType } from '../index.js'
import { renderProjectCard } from '../../services/project-tracker-visuals.js'

const noPerms: PermissionsString[] = []

function guildId(intr: ChatInputCommandInteraction): string | undefined {
  return intr.guildId ?? undefined
}

function bar(progress: number): string {
  const filled = Math.round(progress / 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${progress}%`
}

function status(value: string): TrackerTaskStatus | undefined {
  return TRACKER_TASK_STATUSES.includes(value as TrackerTaskStatus)
    ? (value as TrackerTaskStatus)
    : undefined
}

async function projectOrReply(
  service: ProjectTrackerService,
  intr: ChatInputCommandInteraction,
  name: string,
): Promise<
  | {
      guildId: string
      project: NonNullable<Awaited<ReturnType<ProjectTrackerService['findProject']>>>
    }
  | undefined
> {
  const id = guildId(intr)
  if (!id) {
    await InteractionUtils.send(intr, 'This command can only be used in a server.', true)
    return undefined
  }
  const project = await service.findProject(id, name)
  if (!project) {
    await InteractionUtils.send(intr, `Project **${name}** was not found.`, true)
    return undefined
  }
  return { guildId: id, project }
}

abstract class TrackerCommand {
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms = noPerms

  constructor(
    protected readonly service: ProjectTrackerService,
    protected readonly permissions = new ProjectTrackerPermissions(),
  ) {}

  protected async requirePermission(
    intr: ChatInputCommandInteraction,
    permission: TrackerPermission,
  ): Promise<boolean> {
    if (intr.guild && (await this.permissions.can(intr.guild, intr.user.id, permission)))
      return true
    await InteractionUtils.send(intr, this.permissions.deniedMessage(permission), true)
    return false
  }

  protected async projectsAutocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    if (!intr.guildId) return []
    const projects = await this.service.listProjects(intr.guildId)
    const search = option.value.toLowerCase()
    return projects
      .filter((project) => project.name.toLowerCase().includes(search))
      .slice(0, 25)
      .map((project) => ({ name: project.name, value: project.name }))
  }
}

export class ProjectNewCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.project', Language.Default), 'new']

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    const id = guildId(intr)
    if (!id)
      return void (await InteractionUtils.send(
        intr,
        'This command can only be used in a server.',
        true,
      ))
    if (!(await this.requirePermission(intr, 'createProject'))) return
    const name = intr.options.getString('name', true).trim()
    const description = intr.options.getString('description')?.trim() ?? ''
    try {
      const project = await this.service.createProject(id, name, description, intr.user.id)
      await InteractionUtils.send(intr, `Created project **${project.name}**.`)
    } catch {
      await InteractionUtils.send(intr, `Project **${name}** already exists in this server.`, true)
    }
  }
}

export class ProjectListCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.project', Language.Default), 'list']

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.requirePermission(intr, 'view'))) return
    const id = guildId(intr)
    if (!id)
      return void (await InteractionUtils.send(
        intr,
        'This command can only be used in a server.',
        true,
      ))
    const projects = await this.service.listProjects(
      id,
      intr.options.getBoolean('include_archived') ?? false,
    )
    if (!projects.length) {
      await InteractionUtils.send(
        intr,
        intr.options.getBoolean('include_archived')
          ? 'No projects yet.'
          : 'No active projects. Use `include_archived: True` to include archived projects.',
      )
      return
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('tracker-project:list-select')
      .setPlaceholder('Choose a project to archive or unarchive')
      .addOptions(
        projects.slice(0, 25).map((project) => ({
          label: project.name.slice(0, 100),
          value: String(project.id),
          description:
            project.status === 'archived'
              ? 'Archived · restore this project'
              : 'Active · archive this project',
        })),
      )
    await InteractionUtils.send(intr, {
      content: projects.map((p) => `• **${p.name}** — ${p.status}`).join('\n'),
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    })
  }
}

export class ProjectViewCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.project', Language.Default), 'view']

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.requirePermission(intr, 'view'))) return
    const found = await projectOrReply(this.service, intr, intr.options.getString('name', true))
    if (!found) return
    const summary = await this.service.getSummary(found.guildId, found.project.id)
    if (!summary) return
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
    await InteractionUtils.send(intr, {
      embeds: [
        {
          color: 0x0090ff,
          title: `Project brief · ${summary.project.name}`,
          description: summary.project.description || 'No project description yet.',
          image: { url: `attachment://dgg-project-${summary.project.id}.png` },
        },
      ],
      files: [image],
    })
  }
}

export class MilestoneAddCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.milestone', Language.Default), 'add']

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    const found = await projectOrReply(this.service, intr, intr.options.getString('project', true))
    if (!found) return
    if (!(await this.requirePermission(intr, 'addMilestone'))) return
    if (found.project.status !== 'active') {
      await InteractionUtils.send(
        intr,
        'That project is archived. Unarchive it before editing.',
        true,
      )
      return
    }
    try {
      const milestone = await this.service.createMilestone(
        found.guildId,
        found.project.id,
        intr.options.getString('name', true).trim(),
        intr.options.getString('description')?.trim() ?? '',
      )
      await InteractionUtils.send(
        intr,
        `Added milestone **${milestone.name}** to **${found.project.name}**.`,
      )
    } catch {
      await InteractionUtils.send(intr, 'That milestone already exists in this project.', true)
    }
  }
}

export class MilestoneListCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.milestone', Language.Default), 'list']

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    const found = await projectOrReply(this.service, intr, intr.options.getString('project', true))
    if (!found) return
    if (!(await this.requirePermission(intr, 'view'))) return
    const summary = await this.service.getSummary(found.guildId, found.project.id)
    await InteractionUtils.send(
      intr,
      summary?.milestones.length
        ? summary.milestones
            .map(
              (m) =>
                `• **${m.milestone.name}** — ${m.tasks.filter((t) => t.status === 'done').length}/${m.tasks.length} done`,
            )
            .join('\n')
        : 'No milestones yet.',
    )
  }
}

export class TaskAddCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.task', Language.Default), 'add']

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    const found = await projectOrReply(this.service, intr, intr.options.getString('project', true))
    if (!found) return
    if (!(await this.requirePermission(intr, 'addTask'))) return
    if (found.project.status !== 'active') {
      await InteractionUtils.send(
        intr,
        'That project is archived. Unarchive it before editing.',
        true,
      )
      return
    }
    const milestone = await this.service.findMilestone(
      found.guildId,
      found.project.id,
      intr.options.getString('milestone', true),
    )
    if (!milestone)
      return void (await InteractionUtils.send(intr, 'Milestone not found in that project.', true))
    const task = await this.service.createTask(
      found.guildId,
      found.project.id,
      milestone.id,
      intr.options.getString('title', true).trim(),
      intr.options.getUser('assignee')?.id,
    )
    await InteractionUtils.send(intr, `Added task \`#${task.id}\` to **${milestone.name}**.`)
  }
}

export class TaskListCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.task', Language.Default), 'list']

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    const found = await projectOrReply(this.service, intr, intr.options.getString('project', true))
    if (!found) return
    if (!(await this.requirePermission(intr, 'view'))) return
    const tasks = await this.service.listTasks(
      found.guildId,
      found.project.id,
      status(intr.options.getString('status') ?? ''),
    )
    await InteractionUtils.send(
      intr,
      tasks.length
        ? tasks
            .map(
              (task) =>
                `\`#${task.id}\` [${task.status}] ${task.title}${task.assigneeId ? ` — <@${task.assigneeId}>` : ''}`,
            )
            .join('\n')
        : 'No matching tasks.',
    )
  }
}

export class TaskStatusCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.task', Language.Default), 'status']

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.requirePermission(intr, 'changeTaskStatus'))) return
    const taskId = intr.options.getInteger('task_id', true)
    const next = status(intr.options.getString('status', true))
    if (!next) return void (await InteractionUtils.send(intr, 'Invalid task status.', true))
    const task = await this.service.setTaskStatus(intr.guildId ?? '', taskId, next)
    await InteractionUtils.send(
      intr,
      task ? `Task \`#${task.id}\` is now **${task.status}**.` : 'Task not found.',
      !task,
    )
  }
}

export class TaskAssignCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.task', Language.Default), 'assign']

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.requirePermission(intr, 'assignTask'))) return
    const task = await this.service.assignTask(
      intr.guildId ?? '',
      intr.options.getInteger('task_id', true),
      intr.options.getUser('assignee')?.id,
    )
    await InteractionUtils.send(
      intr,
      task ? `Task \`#${task.id}\` assignment updated.` : 'Task not found.',
      !task,
    )
  }
}

export class TaskDoneCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.task', Language.Default), 'done']

  public async execute(intr: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.requirePermission(intr, 'changeTaskStatus'))) return
    const task = await this.service.setTaskStatus(
      intr.guildId ?? '',
      intr.options.getInteger('task_id', true),
      'done',
    )
    await InteractionUtils.send(
      intr,
      task ? `Completed task \`#${task.id}\`.` : 'Task not found.',
      !task,
    )
  }
}

export class ProgressCommand extends TrackerCommand {
  public names = [Lang.getRef('chatCommands.progress', Language.Default)]

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    return this.projectsAutocomplete(intr, option)
  }

  public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
    if (!(await this.requirePermission(intr, 'view'))) return
    const found = await projectOrReply(this.service, intr, intr.options.getString('project', true))
    if (!found) return
    const summary = await this.service.getSummary(found.guildId, found.project.id)
    if (!summary) return
    await InteractionUtils.send(
      intr,
      `**${summary.project.name}**\n${bar(summary.progress)}\n${summary.completedTasks}/${summary.tasks.length} tasks complete across ${summary.milestones.length} milestones.`,
    )
  }
}
