import fetch from 'node-fetch'
import { URL } from 'node:url'

const REQUEST_TIMEOUT_MS = 10_000
const RECORD_ATTENDANCE_PATH = '/api/discord/record-attendance/'

export interface CrmAttendancePayload {
  event_id: string
  event_name: string
  event_tracker: string
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
    const url = new URL(RECORD_ATTENDANCE_PATH, this.baseUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const res = await fetch(url.toString(), {
        method: 'post',
        headers: {
          Authorization: `Token ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`CRM record-attendance failed: ${res.status} ${text}`)
      }

      return (await res.json()) as CrmAttendanceResponse
    } finally {
      clearTimeout(timer)
    }
  }
}
