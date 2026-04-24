/**
 * Google Calendar API helpers for local scripts (same auth pattern as GoogleCalendarService).
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from 'dotenv'
import { google } from 'googleapis'

/** @see src/constants/google-calendar-scopes.ts */
const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events']

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const projectRoot = join(scriptsDir, '..')

/**
 * @param {unknown} json
 * @returns {Record<string, unknown> | null}
 */
function parseServiceAccountCredentialsJson(json) {
  if (json === null || typeof json !== 'object') return null
  const o = /** @type {Record<string, unknown>} */ (json)
  if (o.type === 'service_account') {
    if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
      return o
    }
    return null
  }
  if (typeof o.client_email === 'string' && typeof o.private_key === 'string') {
    return o
  }
  return null
}

/**
 * Load `scripts/.env` and return calendar settings. Paths in env are relative to the repo root
 * (same as running `node scripts/...` from the project root).
 * @returns {{ calendarId: string, credentialsPath: string, impersonationSubject: string | null }}
 */
export function loadGoogleCalendarEnv() {
  const { error } = config({ path: join(scriptsDir, '.env'), override: false })
  if (error && error.code !== 'ENOENT') {
    console.error(`[google-calendar-harness] could not read scripts/.env:`, error.message)
  }
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim()
  const credRaw =
    process.env.GOOGLE_CALENDAR_CREDENTIALS?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  if (!calendarId) {
    throw new Error('GOOGLE_CALENDAR_ID is required in scripts/.env (or the environment)')
  }
  if (!credRaw) {
    throw new Error(
      'GOOGLE_CALENDAR_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS is required in scripts/.env (e.g. serviceKey.json)',
    )
  }
  const credentialsPath = isAbsolute(credRaw) ? credRaw : join(projectRoot, credRaw)
  const impersonationSubject = process.env.GOOGLE_CALENDAR_IMPERSONATION_SUBJECT?.trim() || null
  return { calendarId, credentialsPath, impersonationSubject }
}

/**
 * @param {string} credentialsPath
 * @param {string | null} impersonationSubject
 */
export async function createCalendarClient(credentialsPath, impersonationSubject) {
  const raw = await readFile(credentialsPath, 'utf-8')
  const json = JSON.parse(raw)
  const credentials = parseServiceAccountCredentialsJson(json)
  if (!credentials) {
    throw new Error(
      'Credentials JSON must be a service account key (type service_account with client_email and private_key).',
    )
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [...GOOGLE_CALENDAR_SCOPES],
    ...(impersonationSubject ? { clientOptions: { subject: impersonationSubject } } : {}),
  })
  return google.calendar({ version: 'v3', auth })
}

/**
 * @param {import('googleapis').calendar_v3.Calendar} calendar
 * @param {string} calendarId
 * @param {{ timeMin: Date, timeMax: Date, singleEvents?: boolean }} opts
 * @returns {Promise<import('googleapis').calendar_v3.Schema$Event[]>}
 */
export async function listEventsInWindow(calendar, calendarId, opts) {
  const { timeMin, timeMax, singleEvents = false } = opts
  const all = []
  let pageToken
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents,
      maxResults: 2500,
      pageToken,
    })
    for (const item of res.data.items ?? []) {
      all.push(item)
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return all
}

/**
 * Shrink API payloads for console / JSON (optional).
 * @param {import('googleapis').calendar_v3.Schema$Event} item
 */
export function summarizeEventForPrint(item) {
  const priv = item.extendedProperties?.private
  return {
    id: item.id,
    status: item.status,
    summary: item.summary,
    start: item.start?.dateTime ?? item.start?.date ?? null,
    end: item.end?.dateTime ?? item.end?.date ?? null,
    location: item.location ?? null,
    recurringEventId: item.recurringEventId ?? null,
    discordScheduledEventId:
      priv && typeof priv.discordScheduledEventId === 'string'
        ? priv.discordScheduledEventId
        : null,
  }
}
