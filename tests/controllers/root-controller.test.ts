import { type Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { RootController } from '../../src/controllers/root-controller.js'
import { Api } from '../../src/models/api.js'

function buildApp(): Express {
  const api = new Api([new RootController()])
  return api.app
}

describe('RootController', () => {
  it('reports a successful health check', async () => {
    const res = await request(buildApp()).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
