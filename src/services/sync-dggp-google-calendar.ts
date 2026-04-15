import type { Client, GuildScheduledEvent } from 'discord.js'
import { GuildScheduledEventStatus } from 'discord.js'
import { createRequire } from 'node:module'

import { DGGP_GUILD_NAME } from '../constants/dggp-guild.js'
import { discordRecurrenceRuleToGoogleRRule } from '../utils/discord-recurrence-to-google-rrule.js'
import type {
  CalendarEventInput,
  GoogleCalendarService,
  ListedCalendarEvent,
} from './google-calendar-service.js'
import { Logger } from './logger.js'

const require = createRequire(import.meta.url)
const Logs = require('../../lang/logs.json')

const DEFAULT_PAST_MS = 365 * 24 * 60 * 60 * 1000
const DEFAULT_FUTURE_MS = 3 * 365 * 24 * 60 * 60 * 1000
const WINDOW_PAD_MS = 7 * 24 * 60 * 60 * 1000

function discordScheduledEventTimeRange(event: GuildScheduledEvent): { start: Date; end: Date } {
  const start =
    event.scheduledStartAt ??
    (event.scheduledStartTimestamp ? new Date(event.scheduledStartTimestamp) : new Date())
  let end =
    event.scheduledEndAt ??
    (event.scheduledEndTimestamp
      ? new Date(event.scheduledEndTimestamp)
      : new Date(start.getTime() + 60 * 60 * 1000))
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000)
  }
  return { start, end }
}

/**
 * Time bounds for `events.list`: default range extended by actual Discord event times (and
 * recurrence end), so empty calendars and long-running series still list correctly.
 */
/** Exported for tests: time bounds passed to Google `events.list`. */
export function listWindowForDiscordEvents(discordEvents: Iterable<GuildScheduledEvent>): {
  timeMin: Date
  timeMax: Date
} {
  const now = Date.now()
  let minUtc = now - DEFAULT_PAST_MS
  let maxUtc = now + DEFAULT_FUTURE_MS

  for (const event of discordEvents) {
    const { start, end } = discordScheduledEventTimeRange(event)
    minUtc = Math.min(minUtc, start.getTime())
    maxUtc = Math.max(maxUtc, end.getTime())
    const ruleEnd = event.recurrenceRule?.endTimestamp
    if (ruleEnd != null && Number.isFinite(ruleEnd)) {
      maxUtc = Math.max(maxUtc, ruleEnd)
    }
  }

  return {
    timeMin: new Date(minUtc - WINDOW_PAD_MS),
    timeMax: new Date(maxUtc + WINDOW_PAD_MS),
  }
}

export function buildCalendarInputFromDiscordEvent(event: GuildScheduledEvent): CalendarEventInput {
  const { start, end } = discordScheduledEventTimeRange(event)
  const description = event.description
    ? `${event.description}\n\nSynced from DGGP Discord: ${event.url}`
    : `Synced from DGGP Discord: ${event.url}`
  const location =
    event.entityMetadata && 'location' in event.entityMetadata
      ? (event.entityMetadata.location ?? null)
      : null

  let recurrence: string[] | null = null
  if (event.recurrenceRule) {
    const rrule = discordRecurrenceRuleToGoogleRRule(event.recurrenceRule, start)
    if (rrule) {
      recurrence = [rrule]
    } else {
      Logger.warn(
        `Calendar sync: Discord event ${event.id} has a recurrence rule that could not be mapped to Google RRULE; creating a single instance only.`,
      )
    }
  }

  return {
    summary: event.name,
    description,
    start,
    end,
    location,
    recurrence,
    discordScheduledEventId: event.id,
  }
}

function needsUpdate(google: ListedCalendarEvent, input: CalendarEventInput): boolean {
  if (google.summary !== input.summary) return true
  if (google.location !== (input.location ?? null)) return true
  if (google.start && Math.abs(google.start.getTime() - input.start.getTime()) > 1000) return true
  if (google.end && Math.abs(google.end.getTime() - input.end.getTime()) > 1000) return true
  return false
}

/**
 * Full reconciliation: list Google Calendar events, compare to DGGP Discord scheduled events,
 * create missing events, update drifted fields, and remove orphaned Google events whose Discord
 * counterpart no longer exists.
 */
export async function syncDggpScheduledEventsToGoogle(
  client: Client,
  calendarService: GoogleCalendarService,
): Promise<void> {
  if (!calendarService.isConfigured()) {
    Logger.info(
      'Calendar sync: skipped — set GOOGLE_CALENDAR_ID and GOOGLE_APPLICATION_CREDENTIALS (or GOOGLE_CALENDAR_CREDENTIALS).',
    )
    return
  }

  if (!(await calendarService.ensureInitialized())) {
    return
  }

  const guild = client.guilds.cache.find(
    (g) => g.name === DGGP_GUILD_NAME || g.name === 'DGGPATestServer',
  )
  if (!guild) {
    Logger.info(`Calendar sync: guild "${DGGP_GUILD_NAME}" not in cache; skip.`)
    return
  }

  let events
  try {
    events = await guild.scheduledEvents.fetch()
  } catch (error) {
    Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', 'scheduledEvents.fetch'), error)
    return
  }

  const { timeMin, timeMax } = listWindowForDiscordEvents(events.values())
  const googleEvents = await calendarService.listEventsBetween(timeMin, timeMax)
  Logger.info(
    `Calendar sync: loaded ${googleEvents.length} Google Calendar event(s) in window ${timeMin.toISOString()} → ${timeMax.toISOString()}.`,
  )

  const discordIdToGoogle = new Map<string, ListedCalendarEvent>()
  for (const ge of googleEvents) {
    if (!ge.discordScheduledEventId) continue
    if (!discordIdToGoogle.has(ge.discordScheduledEventId)) {
      discordIdToGoogle.set(ge.discordScheduledEventId, ge)
    }
  }
  Logger.info(
    `Calendar sync: ${discordIdToGoogle.size} Google event(s) linked to a Discord scheduled event via extended properties.`,
  )

  let created = 0
  let updated = 0
  let unchanged = 0
  let deleted = 0
  const seenDiscordIds = new Set<string>()

  for (const event of events.values()) {
    seenDiscordIds.add(event.id)

    if (event.status === GuildScheduledEventStatus.Canceled) {
      const linked = discordIdToGoogle.get(event.id)
      if (linked) {
        try {
          const ok = await calendarService.deleteEvent(linked.id)
          if (ok) {
            deleted++
            Logger.info(
              `Calendar sync (Google): DELETED googleEventId=${linked.id} (discordId=${event.id} canceled on Discord) summary=${JSON.stringify(linked.summary)}`,
            )
          } else {
            Logger.warn(
              `Calendar sync (Google): DELETE failed for canceled discordId=${event.id} googleEventId=${linked.id}`,
            )
          }
        } catch (error) {
          Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name), error)
        }
      }
      continue
    }

    const input = buildCalendarInputFromDiscordEvent(event)
    Logger.info(
      `Calendar sync (Discord): id=${event.id} name=${JSON.stringify(event.name)} start=${input.start.toISOString()} end=${input.end.toISOString()} status=${event.status} url=${event.url}`,
    )

    let existing = discordIdToGoogle.get(event.id)
    if (!existing) {
      const foundId = await calendarService.findEventByDiscordId(event.id)
      if (foundId) {
        const fetched = await calendarService.getListedEvent(foundId)
        if (fetched) {
          existing = fetched
          discordIdToGoogle.set(event.id, fetched)
        } else {
          Logger.warn(
            `Calendar sync: findEventByDiscordId returned googleEventId=${foundId} but events.get failed; skipping create for discordId=${event.id} to avoid duplicates.`,
          )
          continue
        }
      }
    }
    if (existing) {
      if (needsUpdate(existing, input)) {
        try {
          const ok = await calendarService.updateEvent(existing.id, input)
          if (ok) {
            updated++
            Logger.info(
              `Calendar sync (Google): UPDATED discordId=${event.id} googleEventId=${existing.id} summary=${JSON.stringify(input.summary)}`,
            )
          } else {
            Logger.warn(
              `Calendar sync (Google): UPDATE failed for discordId=${event.id} googleEventId=${existing.id}`,
            )
          }
        } catch (error) {
          Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name), error)
        }
      } else {
        unchanged++
      }
      continue
    }

    try {
      const googleEventId = await calendarService.createEvent(input)
      if (googleEventId) {
        created++
        Logger.info(
          `Calendar sync (Google): CREATED discordId=${event.id} googleEventId=${googleEventId} summary=${JSON.stringify(input.summary)}`,
        )
      } else {
        Logger.warn(
          `Calendar sync (Google): CREATE returned no id for discordId=${event.id} summary=${JSON.stringify(input.summary)}`,
        )
      }
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name), error)
    }
  }

  for (const [discordId, ge] of discordIdToGoogle) {
    if (seenDiscordIds.has(discordId)) continue
    try {
      const ok = await calendarService.deleteEvent(ge.id)
      if (ok) {
        deleted++
        Logger.info(
          `Calendar sync (Google): DELETED orphan googleEventId=${ge.id} (discordId=${discordId} no longer exists) summary=${JSON.stringify(ge.summary)}`,
        )
      }
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', ge.summary ?? discordId), error)
    }
  }

  Logger.info(
    `Calendar sync job finished: ${events.size} Discord event(s); ${created} created, ${updated} updated, ${unchanged} unchanged, ${deleted} removed from Google (canceled Discord events and orphans).`,
  )
}
