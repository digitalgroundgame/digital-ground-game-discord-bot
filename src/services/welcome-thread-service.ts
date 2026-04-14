import {
  ChannelType,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js'
import { createRequire } from 'node:module'

import { Logger } from './logger.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

interface WelcomeThreadConfig {
  channelName: string
  welcomeTeamRoleName: string
  welcomeSupervisorsRoleName: string
  maxActiveThreads: number
  maxTotalThreads: number
  maxWelcomeTeamMembers: number
  inactivityDays: number
}

/**
 * Service to create and manage welcome threads in a designated welcome channel.
 * Threads have restricted visibility (user, welcome team, welcome supervisors),
 * a hard cap on total count, and auto-close after inactivity.
 */
export class WelcomeThreadService {
  private static getConfig(): WelcomeThreadConfig | null {
    const wt = Config.welcomeThread
    if (!wt?.channelName) return null
    return {
      channelName: wt.channelName,
      welcomeTeamRoleName: wt.welcomeTeamRoleName ?? 'Welcome Team',
      welcomeSupervisorsRoleName: wt.welcomeSupervisorsRoleName ?? 'Welcome Supervisors',
      maxActiveThreads: Math.max(1, Number(wt.maxActiveThreads) || 50),
      maxTotalThreads: Math.max(1, Number(wt.maxTotalThreads) || 500),
      maxWelcomeTeamMembers: Math.max(1, Number(wt.maxWelcomeTeamMembers) || 4),
      inactivityDays: Math.max(1, Number(wt.inactivityDays) || 5),
    }
  }

  /**
   * Get presence priority for sorting: online=3, idle=2, dnd=1, offline/null=0
   */
  private static getPresencePriority(m: GuildMember): number {
    const status = m.presence?.status
    switch (status) {
      case 'online':
        return 3
      case 'idle':
        return 2
      case 'dnd':
        return 1
      default:
        return 0
    }
  }

  /**
   * Find the welcome channel by name (case-insensitive).
   */
  public static findWelcomeChannel(guild: Guild): TextChannel | null {
    const config = this.getConfig()
    if (!config) return null
    const name = config.channelName.toLowerCase()
    const channel = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.toLowerCase() === name,
    ) as TextChannel | undefined
    return channel ?? null
  }

  /**
   * Count active (non-archived) threads in the welcome channel.
   */
  public static async getActiveWelcomeThreadCount(channel: TextChannel): Promise<number> {
    const active = await channel.threads.fetchActive()
    return active.threads.size
  }

  /**
   * Check whether the member already has an active welcome thread in this channel.
   */
  public static async memberHasActiveWelcomeThread(
    channel: TextChannel,
    memberId: string,
  ): Promise<boolean> {
    const active = await channel.threads.fetchActive()
    for (const [, thread] of active.threads) {
      try {
        const members = await thread.members.fetch()
        if (members.has(memberId)) return true
      } catch {
        // Skip threads we can't read
      }
    }
    return false
  }

  /**
   * Fetch all threads (active + archived) in the welcome channel.
   */
  public static async getAllWelcomeThreads(channel: TextChannel): Promise<ThreadChannel[]> {
    const threads: ThreadChannel[] = []

    // Fetch active threads
    const active = await channel.threads.fetchActive()
    for (const [, thread] of active.threads) {
      threads.push(thread)
    }

    // Fetch all archived private threads (paginated)
    let hasMore = true
    let before: Date | undefined
    while (hasMore) {
      const fetchOptions: {
        type: 'private'
        fetchAll: boolean
        limit: number
        before?: Date
      } = {
        type: 'private',
        fetchAll: true,
        limit: 100,
      }
      if (before) fetchOptions.before = before

      const archived = await channel.threads.fetchArchived(fetchOptions)
      for (const [, thread] of archived.threads) {
        threads.push(thread as ThreadChannel)
      }
      hasMore = archived.hasMore
      const lastThread = archived.threads.last()
      if (lastThread?.archivedAt) {
        before = lastThread.archivedAt
      } else {
        hasMore = false
      }
    }

    return threads
  }

  /**
   * Enforce the max total threads limit by deleting the oldest threads
   * to make room for a new one.
   */
  public static async enforceMaxTotalThreads(
    channel: TextChannel,
    maxTotal: number,
  ): Promise<void> {
    const allThreads = await this.getAllWelcomeThreads(channel)

    if (allThreads.length < maxTotal) return

    // Sort by creation date ascending (oldest first)
    allThreads.sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0))

    // Delete enough threads to make room for 1 new thread
    const toDelete = allThreads.length - maxTotal + 1
    for (let i = 0; i < toDelete; i++) {
      const thread = allThreads[i]
      if (!thread) continue
      try {
        Logger.info(
          `Deleting oldest welcome thread "${thread.name}" to stay under ${maxTotal} total thread limit`,
        )
        await thread.delete(`Exceeded max total threads limit of ${maxTotal}`)
      } catch (error) {
        Logger.error(`Failed to delete old welcome thread "${thread.name}":`, error)
      }
    }
  }

  private static createThreadName(username: string, userId: string): string {
    const MAX_LENGTH = 100
    const PREFIX = 'welcome-'
    const SEPARATOR = '-'

    const sanitizedUsername = username.replace(/[^a-zA-Z0-9-_]/g, '-')

    const reservedLength = PREFIX.length + SEPARATOR.length + userId.length

    const maxUsernameLength = MAX_LENGTH - reservedLength

    const truncatedUsername = sanitizedUsername.slice(0, Math.max(0, maxUsernameLength))

    return `${PREFIX}${truncatedUsername}${SEPARATOR}${userId}`
  }

  /**
   * Create a private welcome thread for the member, add allowed roles' members,
   * send the standard welcome message. Returns the thread or null if cap reached,
   * config missing, or user already has a thread.
   */
  public static async createWelcomeThread(member: GuildMember): Promise<ThreadChannel | null> {
    const config = this.getConfig()
    if (!config) {
      Logger.warn('Welcome thread config (welcomeThread.channelName) is missing')
      return null
    }

    const channel = this.findWelcomeChannel(member.guild)
    if (!channel) {
      Logger.warn(`Welcome channel "${config.channelName}" not found in ${member.guild.name}`)
      return null
    }

    const activeCount = await this.getActiveWelcomeThreadCount(channel)
    if (activeCount >= config.maxActiveThreads) {
      Logger.warn(
        `Welcome thread cap reached (${activeCount}/${config.maxActiveThreads}) in ${member.guild.name}`,
      )
      return null
    }

    const alreadyHas = await this.memberHasActiveWelcomeThread(channel, member.id)
    if (alreadyHas) {
      Logger.info(`Member ${member.user.tag} already has an active welcome thread, skipping`)
      return null
    }

    // Enforce total thread cap – delete the oldest thread(s) if at or over the limit
    await this.enforceMaxTotalThreads(channel, config.maxTotalThreads)

    const threadName = this.createThreadName(member.user.username, member.user.id)
    let thread: ThreadChannel
    try {
      thread = await channel.threads.create({
        name: threadName,
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 10080, // 7 days in minutes
        reason: `Welcome thread for ${member.user.tag}`,
      })
    } catch (error) {
      Logger.error(`Failed to create welcome thread for ${member.user.tag}:`, error)
      return null
    }

    try {
      await thread.members.add(member.id)
    } catch (error) {
      Logger.error(`Failed to add member ${member.user.tag} to welcome thread:`, error)
      await thread.delete('Failed to add member').catch(() => {
        Logger.error(`Failed to delete welcome thread ${thread.name} after failed member addition`)
      })
      return null
    }

    const welcomeRole = member.guild.roles.cache.find((r) => r.name === config.welcomeTeamRoleName)
    const welcomeSupervisorsRole = member.guild.roles.cache.find(
      (r) => r.name === config.welcomeSupervisorsRoleName,
    )

    const membersToAdd = new Set<string>()
    const allMembers = await member.guild.members.fetch({ withPresences: true })

    const welcomeTeamMembers: GuildMember[] = []
    for (const [, m] of allMembers) {
      if (m.user.bot || m.id === member.id) continue

      const isWelcomeTeam = welcomeRole && m.roles.cache.has(welcomeRole.id)
      const isWelcomeSupervisor =
        welcomeSupervisorsRole && m.roles.cache.has(welcomeSupervisorsRole.id)

      if (isWelcomeSupervisor) {
        membersToAdd.add(m.id)
      } else if (isWelcomeTeam) {
        welcomeTeamMembers.push(m)
      }
    }

    welcomeTeamMembers.sort((a, b) => this.getPresencePriority(b) - this.getPresencePriority(a))
    const selectedWelcomeTeam = welcomeTeamMembers.slice(0, config.maxWelcomeTeamMembers)
    for (const m of selectedWelcomeTeam) {
      membersToAdd.add(m.id)
    }

    for (const userId of membersToAdd) {
      try {
        await thread.members.add(userId)
      } catch (error) {
        Logger.error(`Failed to add member ${userId} to welcome thread:`, error)
      }
    }

    const content = `
### 🗽 Welcome to Digital Ground Game (DGG)
We are a grassroots Liberal political activism community committed to protecting individual liberties, the rule of law, and equal justice.

### 🎯 What We Do
Through our weekly [Call To Action (CTA)](https://digitalgroundgame.org/call-to-action), phonebanking, canvassing, and team-led projects, we organize real political action for real change. Partnering with like-minded organizations, we advance liberal values through a pragmatic, evidence-based approach to improve the material conditions of all Americans.

### 🫡 Get Involved
Activism work isn’t always easy, but we can make it easier by working together to build a brighter future.

A Server Representative will be with you shortly. 
In the meantime, feel free to check out the FAQ, join the conversation, or hop into debate or movie night.`

    try {
      await thread.send({ content })
    } catch (error) {
      Logger.error(`Failed to send welcome message in thread ${thread.name}:`, error)
    }

    Logger.info(
      `Created welcome thread ${thread.name} for ${member.user.tag} in ${member.guild.name}`,
    )
    return thread
  }
}
