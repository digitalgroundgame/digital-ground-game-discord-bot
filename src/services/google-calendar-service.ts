import { OAuth2Client } from 'google-auth-library'
import { google, type calendar_v3 } from 'googleapis'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { GOOGLE_CALENDAR_OAUTH_REDIRECT_URI, GOOGLE_CALENDAR_SCOPES } from '../constants/google-calendar-oauth.js'
import { parseGoogleCredentialsJson } from '../utils/parse-google-calendar-credentials.js'

export interface CalendarEventInput {
  summary: string
  description?: string | null
  start: Date
  end: Date
  location?: string | null
}

function toRFC3339(d: Date): string {
  return d.toISOString()
}

function defaultOAuthTokenPath(): string {
  return join(process.cwd(), 'config/google-calendar-oauth-tokens.json')
}

export class GoogleCalendarService {
  private calendar: calendar_v3.Calendar | null = null
  private calendarId: string | null = null
  private credentialsPath: string | undefined
  private oauthTokenPath: string | undefined
  private initPromise: Promise<void> | null = null

  /**
   * @param credentialsPath Path to either a service account JSON **or** an OAuth 2.0 client
   *   secrets JSON (from Google Cloud → APIs & Services → Credentials → Download JSON).
   * @param oauthTokenPath For OAuth clients only: JSON file with tokens (see `npm run calendar:oauth`).
   */
  constructor(
    calendarId: string | undefined,
    credentialsPath: string | undefined,
    oauthTokenPath?: string | undefined,
  ) {
    this.credentialsPath = calendarId && credentialsPath ? credentialsPath : undefined
    if (this.credentialsPath) {
      this.calendarId = calendarId ?? null
      this.oauthTokenPath = oauthTokenPath ?? defaultOAuthTokenPath()
    }
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
      const parsed = parseGoogleCredentialsJson(json)
      if (!parsed) {
        return
      }
      if (parsed.kind === 'service_account') {
        const auth = new google.auth.GoogleAuth({
          credentials: parsed.credentials,
          scopes: [...GOOGLE_CALENDAR_SCOPES],
        })
        this.calendar = google.calendar({ version: 'v3', auth })
        return
      }
      if (!this.oauthTokenPath) {
        return
      }
      let tokenRaw: string
      try {
        tokenRaw = await readFile(this.oauthTokenPath, 'utf-8')
      } catch {
        return
      }
      const tokens = JSON.parse(tokenRaw) as { refresh_token?: string }
      if (!tokens.refresh_token) {
        return
      }
      const oauth2Client = new OAuth2Client(
        parsed.clientId,
        parsed.clientSecret,
        GOOGLE_CALENDAR_OAUTH_REDIRECT_URI,
      )
      oauth2Client.setCredentials(tokens)
      this.calendar = google.calendar({ version: 'v3', auth: oauth2Client })
    } catch {
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

  public async createEvent(input: CalendarEventInput): Promise<string | null> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return null
    try {
      const res = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: {
          summary: input.summary,
          description: input.description ?? undefined,
          start: { dateTime: toRFC3339(input.start), timeZone: 'UTC' },
          end: { dateTime: toRFC3339(input.end), timeZone: 'UTC' },
          location: input.location ?? undefined,
        },
      })
      return res.data.id ?? null
    } catch {
      return null
    }
  }

  public async updateEvent(
    eventId: string,
    input: CalendarEventInput,
  ): Promise<boolean> {
    await this.ensureClient()
    if (!this.calendar || !this.calendarId) return false
    try {
      await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId,
        requestBody: {
          summary: input.summary,
          description: input.description ?? undefined,
          start: { dateTime: toRFC3339(input.start), timeZone: 'UTC' },
          end: { dateTime: toRFC3339(input.end), timeZone: 'UTC' },
          location: input.location ?? undefined,
        },
      })
      return true
    } catch {
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
    } catch {
      return false
    }
  }
}
