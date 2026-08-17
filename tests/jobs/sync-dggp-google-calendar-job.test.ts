import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CalendarSyncSkippedError } from '../../src/models/control-api/calendar-sync.js'
import { SyncDggpGoogleCalendarJob } from '../../src/jobs/sync-dggp-google-calendar-job.js'
import type { CalendarSyncRunner } from '../../src/services/calendar-sync-runner.js'
import { Logger } from '../../src/services/logger.js'

describe('SyncDggpGoogleCalendarJob', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(() => {})
  })

  it('logs a skipped sync as information and completes the scheduled run', async () => {
    const runner = {
      run: vi.fn(async () => {
        throw new CalendarSyncSkippedError('Calendar configuration is incomplete.')
      }),
    } as unknown as CalendarSyncRunner
    const job = new SyncDggpGoogleCalendarJob(runner)

    await expect(job.run()).resolves.toBeUndefined()
    expect(Logger.info).toHaveBeenCalledWith(
      'Calendar sync: skipped — Calendar configuration is incomplete.',
    )
  })

  it('still rejects an unexpected sync failure', async () => {
    const runner = {
      run: vi.fn(async () => {
        throw new Error('Google Calendar unavailable.')
      }),
    } as unknown as CalendarSyncRunner
    const job = new SyncDggpGoogleCalendarJob(runner)

    await expect(job.run()).rejects.toThrow('Google Calendar unavailable.')
  })
})
