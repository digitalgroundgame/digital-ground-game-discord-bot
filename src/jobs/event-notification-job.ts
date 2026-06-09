import { Snowflake, type Client } from 'discord.js'
import { createRequire } from 'node:module'

import { ScheduledEvent } from '../database/schema.js' 
import { Job } from './job.js'
import { Logger } from '../services/logger.js'

import { TextChannel, GuildScheduledEvent, Guild, Collection } from 'discord.js'

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

    // Sync current Discord server events with the DB
    await this.syncScheduledEvents(guild)

    // Check for any required notifications
    await this.checkAllEventsForNotifications(guild)
  }
  
  private async syncScheduledEvents(guild: Guild) {
    // Fetch the events
    let events
    try {
      events = await guild.scheduledEvents.fetch()
    } catch (error) {
      Logger.error(`Event Notifications: Failed to fetch scheduled events for guild:\n${error}`)
      return
    }

    // Iterate over events
    for (const [, event] of events) {
      // Attempt to fetch event from DB
      // TODO: eventService.getEvent(event.id)

      // If new, add the event
      // TODO: eventService.addEvent({...})

      // If existing, check for changes (update if needed)
      // TODO: eventService.updateEvent({...})
    }
  }

  private async checkAllEventsForNotifications(guild: Guild) {
    // Locate the notifications channel
    const channel = guild.channels.cache.get(this.notificationChannelId) as TextChannel
    if (!channel) {
      Logger.error(
        `Event Notifications: Notification channel (${this.notificationChannelId}) not found`,
      )
      return
    }

    // Fetch the events to check from DB
    let events // TODO: eventService.fetchScheduledEvents()

    // Iterate over each event
    for (const [, event] of events) {
      // Ignore if the event is not within its target notification window
      if (!this.doesEventNeedNotification(event)) continue

      Logger.info(`Event Notifications: Triggering notification for "${event.name}"`)

      // Fetch interested users
      let users
      try {
        // TODO: This will break if we expect 100+ interested users for an event
        users = await event.fetchSubscribers({ limit: 100 })
      } catch (err) {
        Logger.error(
          `Event Notifications: Failed to fetch subscribers for event ${event.name}\n${err}`,
        )
        continue
      }

      // If no subs, skip it
      if (!users || users.size === 0) continue

      // Prepare the message with all interested user @s
      const mentions = users.map((u) => `<@${u.user.id}>`).join(' ')
      const message = `${mentions}\n**${event.name}** starts in ${this.notificationTimeMins} minutes!`

      // Send the notification message
      try {
        await channel.send({ content: message })
      } catch (err) {
        Logger.error(`Event Notifications: Failed to send notification message\n${err}`)
      }
    }

  }

  private doesEventNeedNotification(event: ScheduledEvent): boolean {
    // Calculate the earliest allowable notification Date
    const notifyOffsetMs = this.notificationTimeMins * 60 * 1000
    const notifyTimeDiffMs = event.startTime.getTime() - Date.now() - notifyOffsetMs

    // If event has started, we can dip
    if (notifyTimeDiffMs < 0) {
      return false
    }

    // Fetch notification sent flag
    let hasSentNotification
    // TODO: eventService.getEvent(event.id)
    
    // If notifyTimeDiffMs is within notification window && more than notifyOffsetMs && flag is set
    if (hasSentNotification && notifyTimeDiffMs > 0 && notifyTimeDiffMs > notifyOffsetMs) {
      // Clear the flag
      // TODO: eventService.updateEvent({...})
    }

    // If notifyTimeDiffMs is positive && less than notifyOffsetMs
    if (notifyTimeDiffMs > 0 && notifyOffsetMs <= notifyOffsetMs) {
      // Send notification
      return true
    }

    // Otherwise its too early for a notification
    return false
  }
}
