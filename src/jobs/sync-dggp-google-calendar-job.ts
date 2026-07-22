import { createRequire } from 'node:module'

import { Job } from './job.js'
import { CalendarSyncInProgressError, type CalendarSyncRunner, Logger } from '../services/index.js'

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

  public constructor(private calendarSyncRunner: CalendarSyncRunner) {
    super()
  }

  public async run(): Promise<void> {
    try {
      await this.calendarSyncRunner.run()
    } catch (error) {
      if (error instanceof CalendarSyncInProgressError) {
        Logger.info('Calendar sync: skipped because another sync is already in progress.')
        return
      }

      throw error
    }
  }
}
