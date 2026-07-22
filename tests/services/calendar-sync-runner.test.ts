import { describe, expect, it } from 'vitest'

import {
  CalendarSyncInProgressError,
  CalendarSyncRunner,
} from '../../src/services/calendar-sync-runner.js'

describe('CalendarSyncRunner', () => {
  it('serializes sync attempts and releases the lock after completion', async () => {
    let completeFirstSync: (() => void) | undefined
    let syncCount = 0
    const runner = new CalendarSyncRunner(async (): Promise<void> => {
      syncCount++
      if (syncCount === 1) {
        await new Promise<void>((resolve) => {
          completeFirstSync = resolve
        })
      }
    })

    const firstSync = runner.run()
    await expect(runner.run()).rejects.toBeInstanceOf(CalendarSyncInProgressError)

    completeFirstSync?.()
    await firstSync
    await runner.run()

    expect(syncCount).toBe(2)
  })
})
