import type { GuildScheduledEvent, PartialGuildScheduledEvent } from 'discord.js'
import { createRequire } from 'node:module'

import type { GoogleCalendarService } from '../services/google-calendar-service.js'
import { buildCalendarInputFromDiscordEvent } from '../services/sync-dggp-google-calendar.js'
import { Logger } from '../services/logger.js'

const require = createRequire(import.meta.url)
const Logs = require('../../lang/logs.json')

export class GuildScheduledEventHandler {
  constructor(private calendarService: GoogleCalendarService) {}

  public async onCreate(event: GuildScheduledEvent): Promise<void> {
    if (!this.calendarService.isConfigured()) return
    if (!(await this.calendarService.ensureInitialized())) return

    const input = buildCalendarInputFromDiscordEvent(event)
    try {
      const googleEventId = await this.calendarService.createEvent(input)
      if (googleEventId) {
        Logger.info(
          Logs.info.calendarSyncCreated.replace('{EVENT_NAME}', event.name) +
            ` (discordId=${event.id} googleEventId=${googleEventId})`,
        )
      } else {
        Logger.warn(
          `Calendar sync: CREATE returned no id for discordId=${event.id} summary=${JSON.stringify(event.name)}`,
        )
      }
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name), error)
    }
  }

  public async onUpdate(
    _oldEvent: GuildScheduledEvent | PartialGuildScheduledEvent | null,
    newEvent: GuildScheduledEvent,
  ): Promise<void> {
    if (!this.calendarService.isConfigured()) return
    if (!(await this.calendarService.ensureInitialized())) return

    const input = buildCalendarInputFromDiscordEvent(newEvent)
    try {
      const googleEventId = await this.calendarService.findEventByDiscordId(newEvent.id)
      if (googleEventId) {
        const ok = await this.calendarService.updateEvent(googleEventId, input)
        if (ok) {
          Logger.info(
            Logs.info.calendarSyncUpdated.replace('{EVENT_NAME}', newEvent.name) +
              ` (discordId=${newEvent.id} googleEventId=${googleEventId})`,
          )
        } else {
          Logger.warn(
            `Calendar sync: UPDATE failed for discordId=${newEvent.id} googleEventId=${googleEventId}`,
          )
        }
      } else {
        const createdId = await this.calendarService.createEvent(input)
        if (createdId) {
          Logger.info(
            Logs.info.calendarSyncCreated.replace('{EVENT_NAME}', newEvent.name) +
              ` (discordId=${newEvent.id} googleEventId=${createdId}, created on update — was missing)`,
          )
        }
      }
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', newEvent.name), error)
    }
  }

  public async onDelete(event: GuildScheduledEvent | PartialGuildScheduledEvent): Promise<void> {
    if (!this.calendarService.isConfigured()) return
    if (!(await this.calendarService.ensureInitialized())) return

    const eventName = event.name ?? event.id
    try {
      const googleEventId = await this.calendarService.findEventByDiscordId(event.id)
      if (googleEventId) {
        const ok = await this.calendarService.deleteEvent(googleEventId)
        if (ok) {
          Logger.info(
            Logs.info.calendarSyncDeleted.replace('{EVENT_NAME}', eventName) +
              ` (discordId=${event.id} googleEventId=${googleEventId})`,
          )
        } else {
          Logger.warn(
            `Calendar sync: DELETE failed for discordId=${event.id} googleEventId=${googleEventId}`,
          )
        }
      } else {
        Logger.info(
          `Calendar sync: no Google event found for deleted Discord event discordId=${event.id}; nothing to remove.`,
        )
      }
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', eventName), error)
    }
  }
}
