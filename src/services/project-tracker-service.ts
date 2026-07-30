import { and, eq } from 'drizzle-orm'

import { type Database } from '../database/index.js'
import {
  TRACKER_TASK_STATUSES,
  TRACKER_PROJECT_STATUSES,
  trackerMilestone,
  trackerProject,
  trackerTask,
  type TrackerMilestone,
  type TrackerProject,
  type TrackerTask,
  type TrackerTaskStatus,
  type TrackerProjectStatus,
} from '../database/schema.js'

export const TRACKER_LIMITS = {
  projectName: 100,
  description: 1000,
  milestoneName: 100,
  taskTitle: 200,
} as const

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} is required`)
  if (normalized.length > maxLength) throw new Error(`${field} is too long`)
  return normalized
}

function optionalText(value: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error('Description is too long')
  return normalized
}

function validGuildId(guildId: string): string {
  return requiredText(guildId, 'Guild ID', 32)
}

function validId(id: number, field: string): number {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${field} is invalid`)
  return id
}

export interface ProjectSummary {
  project: typeof trackerProject.$inferSelect
  milestones: Array<{
    milestone: typeof trackerMilestone.$inferSelect
    tasks: Array<typeof trackerTask.$inferSelect>
  }>
  tasks: Array<typeof trackerTask.$inferSelect>
  completedTasks: number
  progress: number
}

export class ProjectTrackerService {
  constructor(private readonly db: Database) {}

  public async createProject(
    guildId: string,
    name: string,
    description: string,
    ownerId: string,
  ): Promise<TrackerProject> {
    guildId = validGuildId(guildId)
    name = requiredText(name, 'Project name', TRACKER_LIMITS.projectName)
    description = optionalText(description, TRACKER_LIMITS.description)
    ownerId = requiredText(ownerId, 'Owner ID', 32)
    return this.db
      .insert(trackerProject)
      .values({ guildId, name, description, ownerId })
      .returning()
      .get()
  }

  public async listProjects(guildId: string, includeArchived = false): Promise<TrackerProject[]> {
    guildId = validGuildId(guildId)
    const rows = await this.db
      .select()
      .from(trackerProject)
      .where(
        includeArchived
          ? eq(trackerProject.guildId, guildId)
          : and(eq(trackerProject.guildId, guildId), eq(trackerProject.status, 'active')),
      )
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }

  public async findProject(guildId: string, name: string): Promise<TrackerProject | undefined> {
    guildId = validGuildId(guildId)
    name = requiredText(name, 'Project name', TRACKER_LIMITS.projectName)
    return this.db
      .select()
      .from(trackerProject)
      .where(and(eq(trackerProject.guildId, guildId), eq(trackerProject.name, name)))
      .get()
  }

  public async setProjectStatus(
    guildId: string,
    projectId: number,
    status: TrackerProjectStatus,
  ): Promise<TrackerProject | undefined> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    if (!TRACKER_PROJECT_STATUSES.includes(status)) throw new Error('Invalid project status')
    return this.db
      .update(trackerProject)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(trackerProject.guildId, guildId), eq(trackerProject.id, projectId)))
      .returning()
      .get()
  }

  public async createMilestone(
    guildId: string,
    projectId: number,
    name: string,
    description: string,
  ): Promise<TrackerMilestone> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    name = requiredText(name, 'Milestone name', TRACKER_LIMITS.milestoneName)
    description = optionalText(description, TRACKER_LIMITS.description)
    const project = await this.findProjectById(guildId, projectId)
    if (!project) throw new Error('Project not found')
    if (project.status !== 'active') throw new Error('Project is archived')
    return this.db
      .insert(trackerMilestone)
      .values({ guildId, projectId, name, description })
      .returning()
      .get()
  }

  public async listMilestones(guildId: string, projectId: number): Promise<TrackerMilestone[]> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    return this.db
      .select()
      .from(trackerMilestone)
      .where(and(eq(trackerMilestone.guildId, guildId), eq(trackerMilestone.projectId, projectId)))
  }

  public async findMilestone(
    guildId: string,
    projectId: number,
    name: string,
  ): Promise<TrackerMilestone | undefined> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    name = requiredText(name, 'Milestone name', TRACKER_LIMITS.milestoneName)
    return this.db
      .select()
      .from(trackerMilestone)
      .where(
        and(
          eq(trackerMilestone.guildId, guildId),
          eq(trackerMilestone.projectId, projectId),
          eq(trackerMilestone.name, name),
        ),
      )
      .get()
  }

  public async createTask(
    guildId: string,
    projectId: number,
    milestoneId: number,
    title: string,
    assigneeId?: string,
  ): Promise<TrackerTask> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    milestoneId = validId(milestoneId, 'Milestone ID')
    title = requiredText(title, 'Task title', TRACKER_LIMITS.taskTitle)
    if (assigneeId !== undefined) assigneeId = requiredText(assigneeId, 'Assignee ID', 32)
    const project = await this.findProjectById(guildId, projectId)
    const milestone = await this.findMilestoneById(guildId, milestoneId)
    if (
      !project ||
      project.status !== 'active' ||
      !milestone ||
      milestone.projectId !== project.id
    ) {
      throw new Error('Project and milestone do not match')
    }
    return this.db
      .insert(trackerTask)
      .values({ guildId, projectId, milestoneId, title, assigneeId })
      .returning()
      .get()
  }

  public async listTasks(
    guildId: string,
    projectId: number,
    status?: TrackerTaskStatus,
  ): Promise<TrackerTask[]> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    return this.db
      .select()
      .from(trackerTask)
      .where(
        status
          ? and(
              eq(trackerTask.guildId, guildId),
              eq(trackerTask.projectId, projectId),
              eq(trackerTask.status, status),
            )
          : and(eq(trackerTask.guildId, guildId), eq(trackerTask.projectId, projectId)),
      )
  }

  public async getTask(guildId: string, taskId: number): Promise<TrackerTask | undefined> {
    guildId = validGuildId(guildId)
    taskId = validId(taskId, 'Task ID')
    return this.db
      .select()
      .from(trackerTask)
      .where(and(eq(trackerTask.guildId, guildId), eq(trackerTask.id, taskId)))
      .get()
  }

  public async setTaskStatus(
    guildId: string,
    taskId: number,
    status: TrackerTaskStatus,
  ): Promise<TrackerTask | undefined> {
    guildId = validGuildId(guildId)
    taskId = validId(taskId, 'Task ID')
    if (!TRACKER_TASK_STATUSES.includes(status)) throw new Error('Invalid task status')
    const task = await this.getTask(guildId, taskId)
    if (!task) return undefined
    const project = await this.findProjectById(guildId, task.projectId)
    if (!project || project.status !== 'active') return undefined
    const now = new Date()
    return this.db
      .update(trackerTask)
      .set({ status, updatedAt: now, completedAt: status === 'done' ? now : null })
      .where(and(eq(trackerTask.guildId, guildId), eq(trackerTask.id, taskId)))
      .returning()
      .get()
  }

  public async assignTask(
    guildId: string,
    taskId: number,
    assigneeId?: string,
  ): Promise<TrackerTask | undefined> {
    guildId = validGuildId(guildId)
    taskId = validId(taskId, 'Task ID')
    if (assigneeId !== undefined) assigneeId = requiredText(assigneeId, 'Assignee ID', 32)
    const task = await this.getTask(guildId, taskId)
    if (!task) return undefined
    const project = await this.findProjectById(guildId, task.projectId)
    if (!project || project.status !== 'active') return undefined
    return this.db
      .update(trackerTask)
      .set({ assigneeId: assigneeId ?? null, updatedAt: new Date() })
      .where(and(eq(trackerTask.guildId, guildId), eq(trackerTask.id, taskId)))
      .returning()
      .get()
  }

  public async getSummary(guildId: string, projectId: number): Promise<ProjectSummary | undefined> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    const project = await this.db
      .select()
      .from(trackerProject)
      .where(and(eq(trackerProject.guildId, guildId), eq(trackerProject.id, projectId)))
      .get()
    if (!project) return undefined

    const milestones = await this.listMilestones(guildId, projectId)
    const tasks = await this.listTasks(guildId, projectId)
    return {
      project,
      milestones: milestones.map((milestone) => ({
        milestone,
        tasks: tasks.filter((task) => task.milestoneId === milestone.id),
      })),
      tasks,
      completedTasks: tasks.filter((task) => task.status === 'done').length,
      progress:
        tasks.length === 0
          ? 0
          : Math.round(
              (tasks.filter((task) => task.status === 'done').length / tasks.length) * 100,
            ),
    }
  }

  public async getGuildSummaries(guildId: string, maxProjects = 25): Promise<ProjectSummary[]> {
    if (!Number.isSafeInteger(maxProjects) || maxProjects < 1 || maxProjects > 25) {
      throw new Error('Project summary limit is invalid')
    }
    const projects = (await this.listProjects(guildId)).slice(0, maxProjects)
    const summaries = await Promise.all(
      projects.map((project) => this.getSummary(guildId, project.id)),
    )
    return summaries.filter((summary): summary is ProjectSummary => summary !== undefined)
  }

  public async createGuidedProject(
    guildId: string,
    projectName: string,
    description: string,
    milestoneName: string,
    taskTitle: string,
    ownerId: string,
  ): Promise<{
    project: TrackerProject
    milestone: TrackerMilestone
    task: TrackerTask
  }> {
    guildId = validGuildId(guildId)
    projectName = requiredText(projectName, 'Project name', TRACKER_LIMITS.projectName)
    description = optionalText(description, TRACKER_LIMITS.description)
    milestoneName = requiredText(milestoneName, 'Milestone name', TRACKER_LIMITS.milestoneName)
    taskTitle = requiredText(taskTitle, 'Task title', TRACKER_LIMITS.taskTitle)
    ownerId = requiredText(ownerId, 'Owner ID', 32)
    return this.db.transaction((tx) => {
      const project = tx
        .insert(trackerProject)
        .values({ guildId, name: projectName, description, ownerId })
        .returning()
        .get()
      const milestone = tx
        .insert(trackerMilestone)
        .values({ guildId, projectId: project.id, name: milestoneName, description: '' })
        .returning()
        .get()
      const task = tx
        .insert(trackerTask)
        .values({
          guildId,
          projectId: project.id,
          milestoneId: milestone.id,
          title: taskTitle,
          assigneeId: ownerId,
        })
        .returning()
        .get()
      return { project, milestone, task }
    })
  }

  public async findProjectById(
    guildId: string,
    projectId: number,
  ): Promise<TrackerProject | undefined> {
    guildId = validGuildId(guildId)
    projectId = validId(projectId, 'Project ID')
    return this.db
      .select()
      .from(trackerProject)
      .where(and(eq(trackerProject.guildId, guildId), eq(trackerProject.id, projectId)))
      .get()
  }

  private async findMilestoneById(
    guildId: string,
    milestoneId: number,
  ): Promise<TrackerMilestone | undefined> {
    return this.db
      .select()
      .from(trackerMilestone)
      .where(and(eq(trackerMilestone.guildId, guildId), eq(trackerMilestone.id, milestoneId)))
      .get()
  }
}
