import fetch, { type RequestInit } from 'node-fetch'
import { URL } from 'node:url'

const REQUEST_TIMEOUT_MS = 10_000
const RECORD_ATTENDANCE_PATH = '/api/discord/staged-event-participations/'
const CAN_RECORD_ATTENDANCE_PATH = '/api/discord/can-record-attendance/'

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
        throw new Error(`CRM ${label} failed: ${res.status} ${text}`)
      }

      return (await res.json()) as T
    } finally {
      clearTimeout(timer)
    }
  }
}
