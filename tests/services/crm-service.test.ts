import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const warnMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))
vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: warnMock, error: vi.fn() },
}))

import { CrmService } from '../../src/services/crm-service.js'

const DM = {
  message_id: '423456789012345678',
  channel_id: '323456789012345678',
  author_id: '123456789012345678',
  created_at: '2026-11-08T12:00:00.000Z',
}

function call(index: number): [string, { method: string; headers: object; body: string }] {
  const args = fetchMock.mock.calls[index]
  if (!args) throw new Error(`fetch was not called ${index + 1} time(s)`)
  return args as [string, { method: string; headers: object; body: string }]
}

function response(status: number, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

describe('CrmService', () => {
  beforeEach(() => {
    vi.stubEnv('CRM_API_URL', 'http://crm.test')
    vi.stubEnv('CRM_API_TOKEN', 'crm-token')
    fetchMock.mockReset()
    warnMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('reportReaction', () => {
    it('POSTs the reaction to the inbound-reactions endpoint', async () => {
      fetchMock.mockResolvedValue(response(202))
      const reaction = {
        message_id: '423456789012345678',
        user_id: '123456789012345678',
        emoji: '👍',
        added: false,
      }

      await new CrmService().reportReaction(reaction)

      const [url, init] = call(0)
      expect(url).toBe('http://crm.test/api/discord/inbound-reactions/')
      expect(init.method).toBe('post')
      expect(JSON.parse(init.body)).toEqual(reaction)
    })
  })

  describe('reportInboundDm', () => {
    it('POSTs the DM IDs and time, without text, to the inbound-dms endpoint', async () => {
      fetchMock.mockResolvedValue(response(202))

      await new CrmService().reportInboundDm(DM)

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = call(0)
      expect(url).toBe('http://crm.test/api/discord/inbound-dms/')
      expect(init.method).toBe('post')
      expect(init.headers).toMatchObject({
        Authorization: 'Token crm-token',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(init.body)).toEqual(DM)
      expect(warnMock).not.toHaveBeenCalled()
    })

    it('retries a 5xx once after about 2s, then logs and swallows the second failure', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue(response(503, 'unavailable'))

      const done = new CrmService().reportInboundDm(DM)
      await vi.advanceTimersByTimeAsync(1_999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      await expect(done).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(warnMock).toHaveBeenCalledTimes(1)
      expect(warnMock.mock.calls[0]?.[0]).toContain('503')
    })

    it('succeeds on the retry after a network error', async () => {
      vi.useFakeTimers()
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      fetchMock.mockResolvedValueOnce(response(202))

      const done = new CrmService().reportInboundDm(DM)
      await vi.advanceTimersByTimeAsync(2_000)

      await expect(done).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(warnMock).not.toHaveBeenCalled()
    })

    it('does not retry a 4xx', async () => {
      fetchMock.mockResolvedValue(response(403))

      await expect(new CrmService().reportInboundDm(DM)).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(warnMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('requestDmCatchUp', () => {
    it('sends one catch-up request', async () => {
      fetchMock.mockResolvedValue(response(202))

      await new CrmService().requestDmCatchUp()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = call(0)
      expect(url).toBe('http://crm.test/api/discord/inbound-dms/catch-up/')
      expect(init.method).toBe('post')
      expect(init.headers).toMatchObject({ Authorization: 'Token crm-token' })
    })
  })
})
