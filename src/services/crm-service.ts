import fetch, { type RequestInit, type Response } from 'node-fetch'
import { URL } from 'node:url'

import { Logger } from './logger.js'

const REQUEST_TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 2_000
const RECORD_ATTENDANCE_PATH = '/api/discord/staged-event-participations/'
const CAN_RECORD_ATTENDANCE_PATH = '/api/discord/can-record-attendance/'
const INBOUND_DM_PATH = '/api/discord/inbound-dms/'
const INBOUND_DM_CATCH_UP_PATH = '/api/discord/inbound-dms/catch-up/'
const INBOUND_REACTION_PATH = '/api/discord/inbound-reactions/'

// IDs and the time only: the CRM never receives a DM's text from this call.
export interface CrmInboundDmPayload {
  message_id: string
  channel_id: string
  author_id: string
  created_at: string // ISO 8601
}

export interface CrmInboundReactionPayload {
  message_id: string // the bot's message that was reacted to
  user_id: string // who reacted
  emoji: string // the emoji itself, or :name: for a custom one
  added: boolean // false when the reaction was removed
}

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

  /** Tells the CRM about a DM sent to the bot. Never throws; failures are logged. */
  public async reportInboundDm(payload: CrmInboundDmPayload): Promise<void> {
    await this.postWithRetry('inbound-dm', INBOUND_DM_PATH, payload)
  }

  /** Tells the CRM someone reacted to, or un-reacted to, a DM the bot sent. Never throws. */
  public async reportReaction(payload: CrmInboundReactionPayload): Promise<void> {
    await this.postWithRetry('inbound-reaction', INBOUND_REACTION_PATH, payload)
  }

  /** Asks the CRM to re-read DMs the bot missed while it was down. Never throws. */
  public async requestDmCatchUp(): Promise<void> {
    await this.postWithRetry('inbound-dm-catch-up', INBOUND_DM_CATCH_UP_PATH, {})
  }

  private async request<T>(label: string, pathAndQuery: string, init: RequestInit): Promise<T> {
    return this.send(pathAndQuery, init, async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`CRM ${label} failed: ${res.status} ${text}`)
      }
      return (await res.json()) as T
    })
  }

  // POSTs JSON for a fire-and-forget call. A network error or 5xx is retried
  // once after RETRY_DELAY_MS; any remaining failure is logged, not thrown.
  private async postWithRetry(label: string, path: string, body: unknown): Promise<void> {
    const init: RequestInit = {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }

    for (let attempt = 1; ; attempt++) {
      let failure: string
      let retryable: boolean
      try {
        const { ok, status, text } = await this.send(path, init, async (res) => ({
          ok: res.ok,
          status: res.status,
          text: await res.text().catch(() => ''),
        }))
        if (ok) {
          return
        }
        failure = `${status} ${text}`
        retryable = status >= 500
      } catch (error) {
        failure = String(error)
        retryable = true
      }

      if (!retryable || attempt >= 2) {
        Logger.warn(`CRM ${label} failed after ${attempt} attempt(s): ${failure}`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  // Sends an authenticated request and reads the response with `read`, both
  // under one REQUEST_TIMEOUT_MS timeout.
  private async send<T>(
    pathAndQuery: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
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
      return await read(res)
    } finally {
      clearTimeout(timer)
    }
  }
}
