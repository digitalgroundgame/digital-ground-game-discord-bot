import { AttachmentBuilder } from 'discord.js'
import { Canvas } from 'canvas'

import { type TrackerTask } from '../database/schema.js'
import { type ProjectSummary } from './project-tracker-service.js'

const DGG = {
  navy: '#0d2847',
  blue: '#0090ff',
  sky: '#59aeea',
  ink: '#071522',
  surface: '#102a46',
  panel: '#173b61',
  line: '#2a587f',
  text: '#f4f8fc',
  muted: '#a9c2d9',
  success: '#42c487',
  warning: '#f2b84b',
  danger: '#ea6b70',
} as const

const WIDTH = 1200
type Context = ReturnType<Canvas['getContext']>

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function canvas(height: number): Canvas {
  return new Canvas(WIDTH, height)
}

function roundedRect(
  context: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: Context['fillStyle'],
): void {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
  context.fillStyle = color
  context.fill()
}

function text(
  context: Context,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string = DGG.text,
  align: 'left' | 'right' | 'center' = 'left',
): void {
  context.font = font
  context.fillStyle = color
  context.textAlign = align
  context.fillText(value, x, y)
}

function drawShell(context: Context, height: number, label: string): void {
  const gradient = context.createLinearGradient(0, 0, WIDTH, height)
  gradient.addColorStop(0, DGG.ink)
  gradient.addColorStop(0.55, DGG.navy)
  gradient.addColorStop(1, '#0a213b')
  roundedRect(context, 0, 0, WIDTH, height, 32, gradient)
  roundedRect(context, 0, 0, 14, height, 7, DGG.blue)
  text(context, 'DGG', 52, 62, '700 34px Arial', DGG.sky)
  text(context, label.toUpperCase(), 52, 91, '700 17px Arial', DGG.muted)
  context.strokeStyle = DGG.line
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(52, 116)
  context.lineTo(WIDTH - 52, 116)
  context.stroke()
}

function drawProgress(
  context: Context,
  x: number,
  y: number,
  width: number,
  progress: number,
  color: string = DGG.blue,
): void {
  roundedRect(context, x, y, width, 12, 6, '#254563')
  roundedRect(context, x, y, Math.max(0, width * (progress / 100)), 12, 6, color)
}

function statusColor(status: TrackerTask['status']): string {
  return status === 'done'
    ? DGG.success
    : status === 'blocked'
      ? DGG.danger
      : status === 'doing'
        ? DGG.sky
        : DGG.muted
}

function statusLabel(status: TrackerTask['status']): string {
  return status === 'done'
    ? 'COMPLETE'
    : status === 'blocked'
      ? 'BLOCKED'
      : status === 'doing'
        ? 'IN PROGRESS'
        : 'NOT STARTED'
}

function attachment(image: Canvas, name: string): AttachmentBuilder {
  return new AttachmentBuilder(image.toBuffer('image/png'), { name })
}

export function renderTrackerDashboard(summaries: ProjectSummary[]): AttachmentBuilder {
  const shown = summaries.slice(0, 6)
  const rows = Math.max(1, Math.ceil(shown.length / 2))
  const image = canvas(208 + rows * 194 + (summaries.length > shown.length ? 42 : 0))
  const context = image.getContext('2d')
  const tasks = summaries.flatMap((summary) => summary.tasks)
  const complete = tasks.filter((task) => task.status === 'done').length
  const blocked = tasks.filter((task) => task.status === 'blocked').length
  const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0
  drawShell(context, image.height, 'Digital Ground Game · Project Tracker')
  text(context, `${progress}%`, WIDTH - 52, 63, '700 42px Arial', DGG.text, 'right')
  text(
    context,
    `${complete}/${tasks.length} tasks complete`,
    WIDTH - 52,
    91,
    '17px Arial',
    DGG.muted,
    'right',
  )
  drawProgress(context, 52, 138, WIDTH - 104, progress, blocked ? DGG.warning : DGG.blue)
  text(
    context,
    blocked ? `${blocked} BLOCKED · PRIORITIZE UNBLOCKING` : 'LIVE PROJECT OVERVIEW',
    52,
    178,
    '700 15px Arial',
    blocked ? DGG.warning : DGG.sky,
  )
  if (!shown.length) {
    roundedRect(context, 52, 204, WIDTH - 104, 154, 18, DGG.surface)
    text(context, 'BUILD THE FIRST TRACKER BOARD', 84, 258, '700 25px Arial')
    text(
      context,
      'Guided setup creates a project, its first milestone, and its first task.',
      84,
      292,
      '18px Arial',
      DGG.muted,
    )
    roundedRect(context, 84, 314, 242, 28, 9, DGG.blue)
    text(context, 'START WITH GUIDED SETUP', 205, 334, '700 13px Arial', DGG.text, 'center')
  }
  shown.forEach((summary, index) => {
    const x = 52 + (index % 2) * 558
    const y = 204 + Math.floor(index / 2) * 194
    const cardWidth = 538
    const hasBlocked = summary.tasks.some((task) => task.status === 'blocked')
    const accent = hasBlocked
      ? DGG.danger
      : summary.progress === 100 && summary.tasks.length
        ? DGG.success
        : DGG.blue
    roundedRect(context, x, y, cardWidth, 170, 18, DGG.surface)
    roundedRect(context, x, y, 8, 170, 4, accent)
    text(context, truncate(summary.project.name, 36), x + 28, y + 39, '700 24px Arial')
    text(
      context,
      `${summary.completedTasks}/${summary.tasks.length} TASKS COMPLETE`,
      x + 28,
      y + 66,
      '700 14px Arial',
      DGG.muted,
    )
    text(
      context,
      `${summary.progress}%`,
      x + cardWidth - 26,
      y + 40,
      '700 28px Arial',
      accent,
      'right',
    )
    drawProgress(context, x + 28, y + 84, cardWidth - 56, summary.progress, accent)
    const preview = summary.tasks.slice(0, 3)
    preview.forEach((task, taskIndex) => {
      const taskY = y + 122 + taskIndex * 20
      context.fillStyle = statusColor(task.status)
      context.beginPath()
      context.arc(x + 34, taskY - 5, 5, 0, Math.PI * 2)
      context.fill()
      text(
        context,
        truncate(`#${task.id} ${task.title}`, 54),
        x + 50,
        taskY,
        '15px Arial',
        '#d9e8f4',
      )
    })
  })
  if (summaries.length > shown.length)
    text(
      context,
      `+${summaries.length - shown.length} more projects available below`,
      52,
      image.height - 20,
      '16px Arial',
      DGG.muted,
    )
  return attachment(image, 'dgg-project-overview.png')
}

export function renderTrackerTree(
  summaries: ProjectSummary[],
  projectId?: number,
  status?: TrackerTask['status'],
): AttachmentBuilder {
  const maxTasks = 300
  const maxMilestones = 150
  const selected = projectId
    ? summaries.filter((summary) => summary.project.id === projectId)
    : summaries
  const taskBudget = Math.max(1, Math.floor(maxTasks / Math.max(1, selected.length)))
  const milestoneBudget = Math.max(1, Math.floor(maxMilestones / Math.max(1, selected.length)))
  const visible = selected.map((summary) => {
    let remainingTaskBudget = taskBudget
    const milestones = summary.milestones
      .slice(0, milestoneBudget)
      .map((group) => {
        const matchingTasks = status
          ? group.tasks.filter((task) => task.status === status)
          : group.tasks
        const tasks = matchingTasks.slice(0, remainingTaskBudget)
        remainingTaskBudget -= tasks.length
        return { ...group, tasks }
      })
      .filter((group) => !status || group.tasks.length)
    return {
      ...summary,
      milestones,
      tasks: status
        ? summary.tasks.filter((task) => task.status === status).slice(0, taskBudget)
        : summary.tasks.slice(0, taskBudget),
    }
  })
  const matchingTaskCount = selected.reduce(
    (count, summary) =>
      count +
      (status
        ? summary.tasks.filter((task) => task.status === status).length
        : summary.tasks.length),
    0,
  )
  const omittedTasks =
    matchingTaskCount - visible.reduce((count, summary) => count + summary.tasks.length, 0)
  const omittedMilestones =
    selected.reduce((count, summary) => count + summary.milestones.length, 0) -
    visible.reduce((count, summary) => count + summary.milestones.length, 0)
  const taskCount = visible.reduce((count, summary) => count + summary.tasks.length, 0)
  const height = Math.max(
    360,
    188 +
      visible.reduce(
        (count, summary) =>
          count +
          76 +
          summary.milestones.reduce((total, group) => total + 42 + group.tasks.length * 24, 0),
        0,
      ),
  )
  const image = canvas(height)
  const context = image.getContext('2d')
  drawShell(context, image.height, 'Project Tree · Full Work Breakdown')
  text(
    context,
    projectId ? `PROJECT FILTER · ${visible[0]?.project.name ?? 'UNKNOWN'}` : 'ALL PROJECTS',
    52,
    157,
    '700 16px Arial',
    DGG.sky,
  )
  text(
    context,
    status
      ? `${statusLabel(status)} · ${taskCount} matching tasks`
      : `${taskCount} tasks across ${visible.length} projects`,
    WIDTH - 52,
    157,
    '700 16px Arial',
    DGG.muted,
    'right',
  )
  let y = 188
  visible.forEach((summary) => {
    const projectColor = summary.tasks.some((task) => task.status === 'blocked')
      ? DGG.danger
      : DGG.blue
    roundedRect(context, 52, y, WIDTH - 104, 58, 14, DGG.panel)
    roundedRect(context, 52, y, 8, 58, 4, projectColor)
    text(context, truncate(summary.project.name, 58), 78, y + 36, '700 23px Arial')
    text(
      context,
      `${summary.progress}% · ${summary.completedTasks}/${summary.tasks.length} tasks`,
      WIDTH - 78,
      y + 36,
      '16px Arial',
      DGG.muted,
      'right',
    )
    y += 70
    summary.milestones.forEach((group) => {
      roundedRect(context, 86, y, WIDTH - 138, 38, 9, DGG.surface)
      text(
        context,
        `└─ ${truncate(group.milestone.name, 52)}`,
        105,
        y + 25,
        '700 16px Arial',
        DGG.sky,
      )
      text(
        context,
        `${group.tasks.length} tasks`,
        WIDTH - 105,
        y + 25,
        '14px Arial',
        DGG.muted,
        'right',
      )
      y += 46
      group.tasks.forEach((task) => {
        context.fillStyle = statusColor(task.status)
        context.beginPath()
        context.arc(130, y + 1, 4, 0, Math.PI * 2)
        context.fill()
        text(
          context,
          `└─ #${task.id} ${truncate(task.title, 65)}`,
          148,
          y + 6,
          '15px Arial',
          '#d9e8f4',
        )
        text(
          context,
          statusLabel(task.status),
          WIDTH - 105,
          y + 6,
          '700 12px Arial',
          statusColor(task.status),
          'right',
        )
        y += 24
      })
    })
    y += 14
  })
  if (omittedTasks > 0 || omittedMilestones > 0)
    text(
      context,
      `Some nodes omitted for payload safety (${omittedMilestones} milestones, ${omittedTasks} tasks); use filters to narrow the tree.`,
      52,
      image.height - 18,
      '14px Arial',
      DGG.warning,
    )
  if (!visible.length)
    text(context, 'No work matches the selected filters.', 52, 222, '20px Arial', DGG.muted)
  return attachment(image, 'dgg-project-tree.png')
}

export function renderProjectCard(
  summary: ProjectSummary,
  assigneeNames: ReadonlyMap<string, string> = new Map(),
): AttachmentBuilder {
  const maxMilestones = 150
  const maxTasks = 300
  const milestones = summary.milestones.slice(0, maxMilestones)
  let remainingTasks = maxTasks
  const visible = milestones.map((group) => {
    const tasks = group.tasks.slice(0, remainingTasks)
    remainingTasks -= tasks.length
    return { ...group, tasks }
  })
  const taskCount = visible.reduce((count, group) => count + group.tasks.length, 0)
  const omittedTasks = summary.tasks.length - taskCount
  const omittedMilestones = summary.milestones.length - visible.length
  const contentHeight = visible.reduce((height, group) => height + 58 + group.tasks.length * 34, 0)
  const image = canvas(
    Math.max(360, 260 + contentHeight + (omittedTasks || omittedMilestones ? 40 : 0)),
  )
  const context = image.getContext('2d')
  const accent = summary.tasks.some((task) => task.status === 'blocked') ? DGG.danger : DGG.blue
  drawShell(context, image.height, 'Project Brief')
  text(context, truncate(summary.project.name, 52), 52, 163, '700 34px Arial')
  text(
    context,
    `${summary.completedTasks}/${summary.tasks.length} TASKS COMPLETE`,
    52,
    192,
    '700 16px Arial',
    DGG.muted,
  )
  text(context, `${summary.progress}%`, WIDTH - 52, 164, '700 38px Arial', accent, 'right')
  drawProgress(context, 52, 213, WIDTH - 104, summary.progress, accent)
  let y = 252
  visible.forEach((group) => {
    const done = group.tasks.filter((task) => task.status === 'done').length
    roundedRect(context, 52, y, WIDTH - 104, 44, 12, DGG.surface)
    text(context, truncate(group.milestone.name, 48), 74, y + 29, '700 18px Arial')
    text(
      context,
      `${done}/${group.tasks.length} tasks`,
      WIDTH - 74,
      y + 29,
      '17px Arial',
      DGG.muted,
      'right',
    )
    y += 52
    group.tasks.forEach((task) => {
      const color = statusColor(task.status)
      context.fillStyle = color
      context.beginPath()
      context.arc(82, y + 9, 5, 0, Math.PI * 2)
      context.fill()
      text(context, `#${task.id} ${truncate(task.title, 52)}`, 100, y + 14, '16px Arial', '#d9e8f4')
      text(context, statusLabel(task.status), WIDTH - 330, y + 14, '700 12px Arial', color, 'right')
      text(
        context,
        task.assigneeId
          ? `Assigned · ${truncate(assigneeNames.get(task.assigneeId) ?? task.assigneeId, 18)}`
          : 'Unassigned',
        WIDTH - 74,
        y + 14,
        '14px Arial',
        DGG.muted,
        'right',
      )
      y += 34
    })
    y += 6
  })
  if (omittedTasks || omittedMilestones)
    text(
      context,
      `Some items omitted for image safety (${omittedMilestones} milestones, ${omittedTasks} tasks).`,
      52,
      image.height - 18,
      '14px Arial',
      DGG.warning,
    )
  if (!summary.milestones.length)
    text(
      context,
      'No milestones yet — add the first stage from the panel.',
      52,
      284,
      '18px Arial',
      DGG.muted,
    )
  return attachment(image, `dgg-project-${summary.project.id}.png`)
}

export function renderTaskCard(
  task: TrackerTask,
  projectName?: string,
  milestoneName?: string,
): AttachmentBuilder {
  const image = canvas(408)
  const context = image.getContext('2d')
  const accent = statusColor(task.status)
  drawShell(context, image.height, 'Task Brief')
  text(context, `TASK #${task.id}`, 52, 164, '700 16px Arial', DGG.sky)
  text(context, truncate(task.title, 58), 52, 208, '700 32px Arial')
  roundedRect(context, 52, 234, 242, 42, 12, DGG.surface)
  text(context, statusLabel(task.status), 72, 262, '700 15px Arial', accent)
  text(
    context,
    projectName ? truncate(projectName, 38) : 'Project unavailable',
    52,
    321,
    '700 19px Arial',
  )
  text(
    context,
    `PROJECT${milestoneName ? ` · ${truncate(milestoneName, 38)}` : ''}`,
    52,
    349,
    '15px Arial',
    DGG.muted,
  )
  text(
    context,
    task.assigneeId ? `ASSIGNED · ${task.assigneeId}` : 'UNASSIGNED',
    52,
    384,
    '15px Arial',
    DGG.muted,
  )
  return attachment(image, `dgg-task-${task.id}.png`)
}

export function renderTrackerGuide(): AttachmentBuilder {
  const image = canvas(570)
  const context = image.getContext('2d')
  drawShell(context, image.height, 'Project Tracker · Quick Start')
  const steps = [
    ['01', 'CREATE A PROJECT', 'Use Guided setup for the fastest first project.'],
    ['02', 'ADD THE WORK', 'Milestones organize stages; tasks are the work items.'],
    ['03', 'KEEP IT CURRENT', 'Complete tasks, then refresh the shared overview.'],
    ['04', 'INSPECT DETAILS', 'Use the two dropdowns for project and task briefs.'],
  ]
  steps.forEach(([number = '', title = '', description = ''], index) => {
    const y = 146 + index * 96
    roundedRect(context, 52, y, WIDTH - 104, 72, 14, DGG.surface)
    text(context, number, 76, y + 45, '700 24px Arial', DGG.blue)
    text(context, title, 150, y + 32, '700 18px Arial')
    text(context, description, 150, y + 56, '16px Arial', DGG.muted)
  })
  return attachment(image, 'dgg-project-tracker-guide.png')
}

export function renderTrackerConfirmation(title: string, detail: string): AttachmentBuilder {
  const image = canvas(318)
  const context = image.getContext('2d')
  drawShell(context, image.height, 'Tracker Update')
  context.fillStyle = DGG.success
  context.beginPath()
  context.arc(84, 190, 32, 0, Math.PI * 2)
  context.fill()
  text(context, '✓', 84, 202, '700 42px Arial', DGG.ink, 'center')
  text(context, truncate(title, 48), 146, 181, '700 28px Arial')
  text(context, truncate(detail, 76), 146, 215, '18px Arial', DGG.muted)
  text(context, 'REFRESH THE OVERVIEW TO SEE THE LATEST STATE', 52, 278, '700 14px Arial', DGG.sky)
  return attachment(image, 'dgg-tracker-update.png')
}
