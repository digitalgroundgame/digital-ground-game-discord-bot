import { type RequestInit, Response } from 'node-fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>

const fetchMock = vi.hoisted(() => vi.fn<FetchMock>())

vi.mock('node-fetch', async () => {
  const actual = await vi.importActual<typeof import('node-fetch')>('node-fetch')
  return {
    ...actual,
    default: fetchMock,
  }
})

const CLOUDFLARE_CHALLENGE_HTML = `
  <!doctype html>
  <html>
    <head><title>Just a moment...</title></head>
    <body>
      <p>Enable JavaScript and cookies to continue</p>
      <script>window._cf_chl_opt = { cType: 'managed' }</script>
    </body>
  </html>
`

describe('CrmService', () => {
  beforeEach(() => {
    process.env.CRM_API_URL = 'https://crm.example.test'
    process.env.CRM_API_TOKEN = 'test-crm-token'
    fetchMock.mockReset()
  })

  afterEach(() => {
    delete process.env.CRM_API_URL
    delete process.env.CRM_API_TOKEN
  })

  it('checks attendance permission with token auth and discord id query', async () => {
    const { CrmService } = await import('../../src/services/crm-service.js')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authorized: true, reason: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const service = new CrmService()
    await expect(service.checkAttendancePermission('210253676080660481')).resolves.toEqual({
      authorized: true,
      reason: 'ok',
    })

    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    const [url, init] = call!
    expect(url).toBe(
      'https://crm.example.test/api/discord/can-record-attendance/?discord_id=210253676080660481',
    )
    expect(init?.method).toBe('get')
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Token test-crm-token',
      }),
    )
  })

  it('omits Cloudflare challenge HTML from failed response errors', async () => {
    const { CrmResponseError, CrmService } = await import('../../src/services/crm-service.js')
    fetchMock.mockResolvedValue(
      new Response(CLOUDFLARE_CHALLENGE_HTML, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      }),
    )

    const service = new CrmService()
    let caught: unknown
    try {
      await service.checkAttendancePermission('210253676080660481')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CrmResponseError)
    const error = caught as InstanceType<typeof CrmResponseError>
    expect(error.message).toContain('CRM can-record-attendance failed: 403 Forbidden')
    expect(error.message).toContain('Cloudflare challenge')
    expect(error.message).toContain('CRM_API_URL')
    expect(error.message).not.toContain('window._cf_chl_opt')
    expect(error.message).not.toContain('Enable JavaScript and cookies')
    expect(error.bodyPreview).toBe('[Cloudflare challenge page omitted]')
    expect(error.isCloudflareChallenge).toBe(true)
  })

  it('classifies Cloudflare challenge HTML returned with a success status as invalid JSON', async () => {
    const { CrmResponseError, CrmService } = await import('../../src/services/crm-service.js')
    fetchMock.mockResolvedValue(
      new Response(CLOUDFLARE_CHALLENGE_HTML, {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=UTF-8' },
      }),
    )

    const service = new CrmService()
    let caught: unknown
    try {
      await service.checkAttendancePermission('210253676080660481')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(CrmResponseError)
    const error = caught as InstanceType<typeof CrmResponseError>
    expect(error.message).toContain('CRM can-record-attendance returned invalid JSON: 200 OK')
    expect(error.message).toContain('Cloudflare challenge')
    expect(error.bodyPreview).toBe('[Cloudflare challenge page omitted]')
  })
})
