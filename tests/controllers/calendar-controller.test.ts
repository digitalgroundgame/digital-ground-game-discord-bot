import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CalendarController } from '../../src/controllers/calendar-controller.js'
import { Api } from '../../src/models/api.js'
import { CalendarSyncInProgressError } from '../../src/services/calendar-sync-runner.js'

const CONTROL_SECRET = 'test-control-secret'

function buildApp(onSync: () => Promise<void>): Express {
  const controller = new CalendarController({ sync: onSync })
  return new Api([controller]).app
}

describe('CalendarController', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_BOT_CONTROL_API_SECRET', CONTROL_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires control API authentication', async () => {
    let syncCount = 0
    const res = await request(
      buildApp(async (): Promise<void> => {
        syncCount++
      }),
    ).post('/calendar/sync')

    expect(res.status).toBe(401)
    expect(syncCount).toBe(0)
  })

  it('refuses to mount without a control API secret', () => {
    vi.stubEnv('DISCORD_BOT_CONTROL_API_SECRET', '')

    expect(() => buildApp(async () => {})).toThrow(/auth token/)
  })

  it('runs a calendar sync through the authenticated control API', async () => {
    let syncCount = 0
    const res = await request(
      buildApp(async (): Promise<void> => {
        syncCount++
      }),
    )
      .post('/calendar/sync')
      .set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'sync', success: true })
    expect(syncCount).toBe(1)
  })

  it('returns service errors to the caller', async () => {
    const res = await request(
      buildApp(async (): Promise<void> => {
        throw new Error('Calendar shard is unavailable')
      }),
    )
      .post('/calendar/sync')
      .set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: 'Calendar shard is unavailable' })
  })

  it('reports a shared in-progress sync as a conflict', async () => {
    const res = await request(
      buildApp(async (): Promise<void> => {
        throw new CalendarSyncInProgressError()
      }),
    )
      .post('/calendar/sync')
      .set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'A calendar sync is already in progress.' })
  })
})
