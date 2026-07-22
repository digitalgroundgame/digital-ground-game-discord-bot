import express, { type Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { CalendarController } from '../../src/controllers/calendar-controller.js'
import { CalendarSyncInProgressError } from '../../src/services/calendar-sync-runner.js'

function buildApp(onSync: () => Promise<void>): Express {
  const controller = new CalendarController({ sync: onSync })
  controller.register()

  const app = express()
  app.use(controller.path, controller.router)
  return app
}

describe('CalendarController', () => {
  it('runs a calendar sync through the local control service', async () => {
    let syncCount = 0
    const res = await request(
      buildApp(async (): Promise<void> => {
        syncCount++
      }),
    ).post('/calendar/sync')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'sync', success: true })
    expect(syncCount).toBe(1)
  })

  it('returns service errors to the caller', async () => {
    const res = await request(
      buildApp(async (): Promise<void> => {
        throw new Error('Calendar shard is unavailable')
      }),
    ).post('/calendar/sync')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Calendar shard is unavailable' })
  })

  it('reports a shared in-progress sync as a conflict', async () => {
    const res = await request(
      buildApp(async (): Promise<void> => {
        throw new CalendarSyncInProgressError()
      }),
    ).post('/calendar/sync')

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A calendar sync is already in progress.' })
  })
})
