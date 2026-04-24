import { type Client } from 'discord.js'
import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { GoogleCalendarService } from '../services/google-calendar-service.js'
import { syncDggpScheduledEventsToGoogle } from '../services/sync-dggp-google-calendar.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * One-shot reconcile shortly after the bot becomes ready. Uses a per-second cron so
 * `JobService` schedules the first (and only) run within ~1s instead of waiting for the
 * next hourly boundary.
 */
export class ImmediateSyncDggpGoogleCalendarJob extends Job {
  public name = 'Immediate sync DGGP Google Calendar'
  public schedule: string = Config.jobs.syncDggpGoogleCalendarImmediate?.schedule ?? '* * * * * *'
  public log: boolean = Config.jobs.syncDggpGoogleCalendarImmediate?.log ?? true
  public override runOnce: boolean = Config.jobs.syncDggpGoogleCalendarImmediate?.runOnce ?? true
  public override initialDelaySecs: number =
    Config.jobs.syncDggpGoogleCalendarImmediate?.initialDelaySecs ?? 0

  constructor(
    private client: Client,
    private calendarService: GoogleCalendarService,
  ) {
    super()
  }

  public async run(): Promise<void> {
    await syncDggpScheduledEventsToGoogle(this.client, this.calendarService)
  }
}
