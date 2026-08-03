import { type Express } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Api } from '../../src/models/api.js'
import { Logger } from '../../src/services/index.js'

function stubListen(api: Api): ReturnType<typeof vi.fn> {
  const listen = vi.fn((port: number, callback: () => void) => callback())
  api.app.listen = listen as unknown as Express['listen']
  return listen
}

describe('Api', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('listens on the PORT env var when set', async () => {
    vi.stubEnv('PORT', '4567')
    const api = new Api([])
    const listen = stubListen(api)

    await api.start()

    expect(listen).toHaveBeenCalledWith(4567, expect.any(Function))
  })

  it('falls back to the configured port when PORT is unset', async () => {
    vi.stubEnv('PORT', '')
    const api = new Api([])
    const listen = stubListen(api)

    await api.start()

    expect(listen).toHaveBeenCalledWith(3000, expect.any(Function))
  })

  it('rejects an invalid PORT during construction', () => {
    vi.stubEnv('PORT', 'invalid')

    expect(() => new Api([])).toThrow("Invalid PORT: 'invalid'")
  })
})
