import fetch, { type RequestInit } from 'node-fetch'
import { URL } from 'node:url'

const REQUEST_TIMEOUT_MS = 10_000
const RESPONSE_BODY_PREVIEW_CHARS = 500
const RECORD_ATTENDANCE_PATH = '/api/discord/staged-event-participations/'
const CAN_RECORD_ATTENDANCE_PATH = '/api/discord/can-record-attendance/'
const CLOUDFLARE_CHALLENGE_MARKERS = [
  'Just a moment...',
  'Enable JavaScript and cookies to continue',
  'window._cf_chl_opt',
  '/cdn-cgi/challenge-platform/',
] as const

export interface CrmAttendancePayload {
  event_id: string
  event_name: string
  event_tracker_discord_id: string
  participants: Array<{
    discord_id: string
    discord_name: string
    status: 'ATTENDED'
  }>
}

export interface CrmAttendanceResponse {
  event_id: string
  total_received: number
  unlinked_participants: Array<{
    discord_id: string
    discord_name: string
  }>
}

// Mirrored from Server/dggcrm/discord/permissions.py — keep in sync.
export type AttendancePermissionReason =
  | 'ok'
  | 'missing_tracker'
  | 'unlinked_discord_id'
  | 'not_authorized'

export interface CrmAttendancePermissionResponse {
  authorized: boolean
  reason: AttendancePermissionReason
}

type CrmResponseFailureReason = 'http_status' | 'invalid_json'

interface CrmResponseErrorOptions {
  label: string
  status: number
  statusText: string
  contentType: string | null
  body: string
  reason: CrmResponseFailureReason
}

function summarizeBody(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim()
  if (normalized.length <= RESPONSE_BODY_PREVIEW_CHARS) {
    return normalized
  }

  return `${normalized.slice(0, RESPONSE_BODY_PREVIEW_CHARS)}...`
}

function isCloudflareChallengeResponse(body: string): boolean {
  return CLOUDFLARE_CHALLENGE_MARKERS.some((marker) => body.includes(marker))
}

export class CrmResponseError extends Error {
  public readonly label: string
  public readonly status: number
  public readonly statusText: string
  public readonly contentType: string | null
  public readonly bodyPreview: string
  public readonly isCloudflareChallenge: boolean

  constructor(options: CrmResponseErrorOptions) {
    const bodyPreview = summarizeBody(options.body)
    const isCloudflareChallenge = isCloudflareChallengeResponse(options.body)
    const statusDescription = options.statusText
      ? `${options.status} ${options.statusText}`
      : `${options.status}`
    const failureDescription =
      options.reason === 'invalid_json' ? 'returned invalid JSON' : 'failed'
    const contentTypeDescription = options.contentType
      ? `; content-type ${options.contentType}`
      : ''
    const bodyDescription = bodyPreview ? `; response body preview: ${bodyPreview}` : ''
    const message = isCloudflareChallenge
      ? `CRM ${options.label} ${failureDescription}: ${statusDescription} (Cloudflare challenge). Configure Cloudflare to bypass browser challenges for this Discord API route, or set CRM_API_URL to an unchallenged internal/origin URL.`
      : `CRM ${options.label} ${failureDescription}: ${statusDescription}${contentTypeDescription}${bodyDescription}`

    super(message)
    this.name = 'CrmResponseError'
    this.label = options.label
    this.status = options.status
    this.statusText = options.statusText
    this.contentType = options.contentType
    this.bodyPreview = isCloudflareChallenge ? '[Cloudflare challenge page omitted]' : bodyPreview
    this.isCloudflareChallenge = isCloudflareChallenge
  }
}

export class CrmService {
  private readonly baseUrl: URL
  private readonly token: string

  constructor() {
    const baseUrl = process.env.CRM_API_URL
    const token = process.env.CRM_API_TOKEN
    if (!baseUrl || !token) {
      throw new Error('CRM_API_URL and CRM_API_TOKEN must be set')
    }
    try {
      this.baseUrl = new URL(baseUrl)
    } catch {
      throw new Error(`CRM_API_URL is not a valid URL: ${baseUrl}`)
    }
    this.token = token
  }

  public async recordAttendance(payload: CrmAttendancePayload): Promise<CrmAttendanceResponse> {
    return this.request<CrmAttendanceResponse>('record-attendance', RECORD_ATTENDANCE_PATH, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  public async checkAttendancePermission(
    discordId: string,
  ): Promise<CrmAttendancePermissionResponse> {
    const url = new URL(CAN_RECORD_ATTENDANCE_PATH, this.baseUrl)
    url.searchParams.set('discord_id', discordId)
    return this.request<CrmAttendancePermissionResponse>(
      'can-record-attendance',
      url.pathname + url.search,
      { method: 'get' },
    )
  }

  private async request<T>(label: string, pathAndQuery: string, init: RequestInit): Promise<T> {
    const url = new URL(pathAndQuery, this.baseUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url.toString(), {
        ...init,
        headers: {
          Authorization: `Token ${this.token}`,
          Accept: 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new CrmResponseError({
          label,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get('content-type'),
          body: text,
          reason: 'http_status',
        })
      }

      const text = await res.text()
      try {
        return JSON.parse(text) as T
      } catch {
        throw new CrmResponseError({
          label,
          status: res.status,
          statusText: res.statusText,
          contentType: res.headers.get('content-type'),
          body: text,
          reason: 'invalid_json',
        })
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
