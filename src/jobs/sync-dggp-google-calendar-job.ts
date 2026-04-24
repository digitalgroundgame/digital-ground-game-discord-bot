import { type Client } from 'discord.js'
import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { GoogleCalendarService } from '../services/google-calendar-service.js'
import { syncDggpScheduledEventsToGoogle } from '../services/sync-dggp-google-calendar.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/** Reconcile DGGP Discord scheduled events with Google Calendar on a fixed interval. */
export class SyncDggpGoogleCalendarJob extends Job {
  public name = 'Sync DGGP Google Calendar'
  public schedule: string = Config.jobs.syncDggpGoogleCalendar?.schedule ?? '0 0 * * * *'
  public log: boolean = Config.jobs.syncDggpGoogleCalendar?.log ?? true
  public override runOnce: boolean = Config.jobs.syncDggpGoogleCalendar?.runOnce ?? false
  public override initialDelaySecs: number =
    Config.jobs.syncDggpGoogleCalendar?.initialDelaySecs ?? 60

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
