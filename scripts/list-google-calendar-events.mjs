#!/usr/bin/env node
/**
 * List Google Calendar events in a time window using a service account key (e.g. `serviceKey.json`).
 *
 * Config (from `scripts/.env` and/or the process environment):
 * - GOOGLE_CALENDAR_ID (required)
 * - GOOGLE_CALENDAR_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS (required; path relative to repo root, e.g. `serviceKey.json`)
 * - GOOGLE_CALENDAR_IMPERSONATION_SUBJECT (optional; domain-wide delegation)
 * - GOOGLE_LIST_DAYS_PAST (default 365)
 * - GOOGLE_LIST_DAYS_FUTURE (default 1095)
 * - GOOGLE_LIST_SINGLE_EVENTS: if `true` / `1`, expand recurring events into instances (default false, matches sync behavior)
 * - GOOGLE_LIST_RAW: if `true` / `1`, print full API event objects; otherwise a compact summary per event
 *
 * Usage: `node scripts/list-google-calendar-events.mjs`
 */
import {
  createCalendarClient,
  listEventsInWindow,
  loadGoogleCalendarEnv,
  summarizeEventForPrint,
} from './lib/google-calendar-harness.mjs'

function envFlag(name) {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

async function main() {
  const { calendarId, credentialsPath, impersonationSubject } = loadGoogleCalendarEnv()
  const daysPast = Number(process.env.GOOGLE_LIST_DAYS_PAST || 365)
  const daysFuture = Number(process.env.GOOGLE_LIST_DAYS_FUTURE || 365 * 3)
  if (Number.isNaN(daysPast) || Number.isNaN(daysFuture)) {
    throw new Error('GOOGLE_LIST_DAYS_PAST and GOOGLE_LIST_DAYS_FUTURE must be numbers')
  }

  const now = new Date()
  const timeMin = new Date(now.getTime() - daysPast * 24 * 60 * 60 * 1000)
  const timeMax = new Date(now.getTime() + daysFuture * 24 * 60 * 60 * 1000)
  const singleEvents = envFlag('GOOGLE_LIST_SINGLE_EVENTS')
  const raw = envFlag('GOOGLE_LIST_RAW')

  const calendar = await createCalendarClient(credentialsPath, impersonationSubject)
  const items = await listEventsInWindow(calendar, calendarId, { timeMin, timeMax, singleEvents })

  const out = raw ? items : items.map(summarizeEventForPrint)
  console.log(
    JSON.stringify(
      {
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents,
        count: out.length,
        events: out,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
