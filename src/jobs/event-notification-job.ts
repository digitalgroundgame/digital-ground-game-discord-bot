import { type Client } from 'discord.js'
import { createRequire } from 'node:module'

import { Job } from './job.js'
import { Logger } from '../services/logger.js'

import { TextChannel, GuildScheduledEvent } from 'discord.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Job that monitors scheduled events and fires off notifications in the
 * specified channel to alert users of upcoming events.
 */
export class EventNotificationJob extends Job {
  public name = 'Event Notification Job'
  public schedule: string = Config.jobs.eventNotifications?.schedule ?? '0 0 * * * *'
  public log: boolean = Config.jobs.eventNotifications?.log ?? true
  public override runOnce: boolean = Config.jobs.eventNotifications?.runOnce ?? false
  public override initialDelaySecs: number = Config.jobs.eventNotifications?.initialDelaySecs ?? 120

  public notificationTimeMins: number = Config.jobs.eventNotifications?.notificationTimeMins ?? 15
  public notificationChannelId: string =
    Config.jobs.eventNotifications?.notificationsChannelId ?? null

  constructor(private client: Client) {
    super()
  }

  public async run(): Promise<void> {
    // Fetch the target guild
    const guildId = process.env.DISCORD_GUILD_ID
    const guild = this.client.guilds.cache.find((g) => g.id === guildId)
    if (!guild) {
      Logger.info(`Event Notifications: guild "${guildId}" not in cache; skipping run`)
      return
    }

    // Locate the notifications channel
    const channel = guild.channels.cache.get(this.notificationChannelId) as TextChannel
    if (!channel) {
<<<<<<< HEAD
      Logger.error(`Event Notifications: Notification channel (${this.notificationChannelId}) not found`)
=======
      Logger.error('Event Notifications: Notification channel not found')
>>>>>>> 73ae0785e450401e0350d9d2ab0000d6f1614018
      return
    }

    // Fetch the events
    let events
    try {
      events = await guild.scheduledEvents.fetch()
    } catch (error) {
<<<<<<< HEAD
        Logger.error(`Event Notifications: Failed to fetch scheduled events for guild:\n${error}`)
        return
=======
      Logger.error('Event Notifications: Failed to fetch scheduled events for guild')
      return
>>>>>>> 73ae0785e450401e0350d9d2ab0000d6f1614018
    }

    // Define the current wake's scan window
    // NOTE: This assumes we actually woke a minute ago!
    const now = new Date()
    const prev = new Date(now.getTime() - (60 * 1000))

    for (const [, event] of events) {
      // Ignore if the event has no start timestamp
      if (!event.scheduledStartTimestamp) continue

      // Ignore if the event is not within its target notification window
      if (!this.doesEventNeedNotification(event, prev, now)) continue

      Logger.info(`Event Notifications: Triggering notification for "${event.name}"`)

      // Fetch interested users
      let users
      try {
        // TODO: This will break if we expect 100+ interested users for an event
        users = await event.fetchSubscribers({ limit: 100 })
      } catch (err) {
        Logger.error(`Event Notifications: Failed to fetch subscribers for event ${event.name}\n${err}`)
        continue
      }

      if (!users || users.size === 0) continue

      // Prepare the message with all interested user @s
      const mentions = users.map((u) => `<@${u.user.id}>`).join(' ')
      const message = `${mentions}\n**${event.name}** starts in ${this.notificationTimeMins} minutes!`

      // Send the notification message
      try {
        await channel.send({ content: message })
      } catch (err) {
<<<<<<< HEAD
        Logger.error(`Event Notifications: Failed to send notification message\n${err}`)
=======
        Logger.error('Event Notifications: Failed to send notification message')
>>>>>>> 73ae0785e450401e0350d9d2ab0000d6f1614018
      }
    }
  }

  private doesEventNeedNotification(event: GuildScheduledEvent, prev: Date, now: Date): boolean {
    // Define the notifiation window
    const notifyOffsetMs = this.notificationTimeMins * 60 * 1000
    const notifyTime = new Date(event.scheduledStartTimestamp! - notifyOffsetMs)

    // Return the status of whether we're in the notification window
    return prev < notifyTime && now >= notifyTime
  }
}
