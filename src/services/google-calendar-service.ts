import { google, type calendar_v3 } from 'googleapis'
import { readFile } from 'node:fs/promises'

import { GOOGLE_CALENDAR_SCOPES } from '../constants/google-calendar-scopes.js'
import { parseServiceAccountCredentialsJson } from '../utils/parse-google-calendar-credentials.js'
import { Logger } from './logger.js'

function formatGoogleApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as Readonly<{
      message?: string
      code?: string | number
      response?: Readonly<{ status?: number; data?: unknown }>
    }>
    const parts: string[] = []
    if (e.message) parts.push(e.message)
    if (e.code !== undefined) parts.push(`code=${String(e.code)}`)
    if (e.response?.status !== undefined) parts.push(`http=${String(e.response.status)}`)
    if (e.response?.data !== undefined) {
      try {
        parts.push(`data=${JSON.stringify(e.response.data)}`)
      } catch {
        parts.push('data=<unserializable>')
      }
    }
    if (parts.length > 0) return parts.join(' | ')
  }
  if (err instanceof Error) return err.message
  return String(err)
}

export interface CalendarEventInput {
  summary: string
  description?: string | null
  start: Date
  end: Date
  location?: string | null
  /** Google Calendar recurrence lines, e.g. `['RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO']` */
  recurrence?: string[] | null
  /** Discord Guild Scheduled Event ID stored in Google Calendar extended properties. */
  discordScheduledEventId?: string | null
}

/** Fields from `events.list` used to correlate and diff with Discord. */
export interface ListedCalendarEvent {
  id: string
  summary?: string | null
  description?: string | null
  start?: Date | null
  end?: Date | null
  location?: string | null
  discordScheduledEventId?: string | null
}

const DISCORD_EVENT_ID_KEY = 'discordScheduledEventId'

function toRFC3339(d: Date): string {
  return d.toISOString()
}

export class GoogleCalendarService {
  private calendar: calendar_v3.Calendar | null = null
  private calendarId: string | null = null
  private credentialsPath: string | undefined
  private impersonationSubject: string | undefined
  private initPromise: Promise<void> | null = null

  /**
   * @param credentialsPath Path to a service account JSON key from Google Cloud.
   * @param impersonationSubject If set, domain-wide delegation user (calendar must be shared with
   *   this user). If unset, requests use the service account identity (share calendar with
   *   `client_email` from the key).
   */
  constructor(
    calendarId: string | undefined,
    credentialsPath: string | undefined,
    impersonationSubject?: string | undefined,
  ) {
    const calId = calendarId?.trim() || undefined
    const credPath = credentialsPath?.trim() || undefined
    this.impersonationSubject = impersonationSubject?.trim() || undefined
    this.credentialsPath = calId && credPath ? credPath : undefined
    if (this.credentialsPath) {
      this.calendarId = calId ?? null
    }
  }

  /** Load credentials and construct the API client. Call before list/create; use `isEnabled()` after. */
  public async ensureInitialized(): Promise<boolean> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) {
      Logger.error(
        'Google Calendar: client is not initialized. Check GOOGLE_CALENDAR_CREDENTIALS / GOOGLE_APPLICATION_CREDENTIALS path, that the file is a service account JSON, and GOOGLE_CALENDAR_ID. Recent errors should appear above.',
      )
      return false
    }
    return true
  }

  private async ensureClient(): Promise<void> {
    if (this.calendar) return
    if (!this.credentialsPath) return
    if (this.initPromise) {
      await this.initPromise
      return
    }
    this.initPromise = this.initClient(this.credentialsPath)
    await this.initPromise
  }

  private async initClient(credentialsPath: string): Promise<void> {
    try {
      const raw = await readFile(credentialsPath, 'utf-8')
      const json: unknown = JSON.parse(raw)
      const credentials = parseServiceAccountCredentialsJson(json)
      if (!credentials) {
        Logger.error(
          'Google Calendar: credentials JSON must be a service account key (type service_account with client_email and private_key).',
        )
        return
      }
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: [...GOOGLE_CALENDAR_SCOPES],
        ...(this.impersonationSubject
          ? { clientOptions: { subject: this.impersonationSubject } }
          : {}),
      })
      this.calendar = google.calendar({ version: 'v3', auth })
    } catch (err: unknown) {
      Logger.error(
        `Google Calendar: failed to read or parse credentials at ${credentialsPath}: ${formatGoogleApiError(err)}`,
        err,
      )
      this.calendar = null
    }
  }

  /** True when calendar ID and credentials path are set (sync should be attempted). */
  public isConfigured(): boolean {
    return this.calendarId !== null && this.credentialsPath !== undefined
  }

  /** True after client has been successfully initialized. */
  public isEnabled(): boolean {
    return this.calendar !== null && this.calendarId !== null
  }

  /**
   * List non-deleted events in [timeMin, timeMax] (paginated). Uses primary `dateTime` bounds.
   */
  public async listEventsBetween(timeMin: Date, timeMax: Date): Promise<ListedCalendarEvent[]> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return []
    const out: ListedCalendarEvent[] = []
    let pageToken: string | undefined
    try {
      do {
        const res = await this.calendar.events.list({
          calendarId: this.calendarId,
          timeMin: toRFC3339(timeMin),
          timeMax: toRFC3339(timeMax),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500,
          pageToken,
        })
        for (const item of res.data.items ?? []) {
          if (item.id && item.status !== 'cancelled') {
            out.push({
              id: item.id,
              summary: item.summary,
              description: item.description,
              start: item.start?.dateTime ? new Date(item.start.dateTime) : null,
              end: item.end?.dateTime ? new Date(item.end.dateTime) : null,
              location: item.location ?? null,
              discordScheduledEventId:
                item.extendedProperties?.private?.[DISCORD_EVENT_ID_KEY] ?? null,
            })
          }
        }
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken)
    } catch (err: unknown) {
      Logger.error(
        `Google Calendar: events.list failed: ${formatGoogleApiError(err)} For calendar list operations the calendar must be shared with the service account (or with the impersonation user if set).`,
        err,
      )
      return out
    }
    return out
  }

  public async createEvent(input: CalendarEventInput): Promise<string | null> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return null
    try {
      const body: calendar_v3.Schema$Event = {
        summary: input.summary,
        description: input.description ?? undefined,
        start: { dateTime: toRFC3339(input.start), timeZone: 'UTC' },
        end: { dateTime: toRFC3339(input.end), timeZone: 'UTC' },
        location: input.location ?? undefined,
      }
      if (input.recurrence?.length) {
        body.recurrence = input.recurrence
      }
      if (input.discordScheduledEventId) {
        body.extendedProperties = {
          private: { [DISCORD_EVENT_ID_KEY]: input.discordScheduledEventId },
        }
      }
      const res = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: body,
      })
      return res.data.id ?? null
    } catch (err: unknown) {
      Logger.error(`Google Calendar: events.insert failed: ${formatGoogleApiError(err)}`, err)
      return null
    }
  }

  public async updateEvent(eventId: string, input: CalendarEventInput): Promise<boolean> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return false
    try {
      const body: calendar_v3.Schema$Event = {
        summary: input.summary,
        description: input.description ?? undefined,
        start: { dateTime: toRFC3339(input.start), timeZone: 'UTC' },
        end: { dateTime: toRFC3339(input.end), timeZone: 'UTC' },
        location: input.location ?? undefined,
      }
      if (input.recurrence?.length) {
        body.recurrence = input.recurrence
      }
      if (input.discordScheduledEventId) {
        body.extendedProperties = {
          private: { [DISCORD_EVENT_ID_KEY]: input.discordScheduledEventId },
        }
      }
      await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId,
        requestBody: body,
      })
      return true
    } catch (err: unknown) {
      Logger.error(`Google Calendar: events.patch failed: ${formatGoogleApiError(err)}`, err)
      return false
    }
  }

  public async deleteEvent(eventId: string): Promise<boolean> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return false
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId,
      })
      return true
    } catch (err: unknown) {
      Logger.error(`Google Calendar: events.delete failed: ${formatGoogleApiError(err)}`, err)
      return false
    }
  }

  /**
   * Find the Google Calendar event ID for a given Discord scheduled event ID
   * using the private extended property filter.
   */
  public async findEventByDiscordId(discordEventId: string): Promise<string | null> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return null
    try {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: [`${DISCORD_EVENT_ID_KEY}=${discordEventId}`],
        maxResults: 1,
      })
      const item = res.data.items?.[0]
      return item?.id && item.status !== 'cancelled' ? item.id : null
    } catch (err: unknown) {
      Logger.error(
        `Google Calendar: findEventByDiscordId failed for ${discordEventId}: ${formatGoogleApiError(err)}`,
        err,
      )
      return null
    }
  }
}
