export const CALENDAR_SYNC_MESSAGE_TYPE = 'calendar-sync'

export interface CalendarSyncRequest {
  type: typeof CALENDAR_SYNC_MESSAGE_TYPE
  kind: 'request'
  requestId: string
}

export interface CalendarSyncResult {
  type: typeof CALENDAR_SYNC_MESSAGE_TYPE
  kind: 'result'
  requestId: string
  success: boolean
  error?: string
  busy?: boolean
}

export function isCalendarSyncRequest(message: unknown): message is CalendarSyncRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === CALENDAR_SYNC_MESSAGE_TYPE &&
    'kind' in message &&
    message.kind === 'request' &&
    'requestId' in message &&
    typeof message.requestId === 'string'
  )
}

export function isCalendarSyncResult(message: unknown): message is CalendarSyncResult {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === CALENDAR_SYNC_MESSAGE_TYPE &&
    'kind' in message &&
    message.kind === 'result' &&
    'requestId' in message &&
    typeof message.requestId === 'string' &&
    'success' in message &&
    typeof message.success === 'boolean' &&
    (!('error' in message) || typeof message.error === 'string') &&
    (!('busy' in message) || typeof message.busy === 'boolean')
  )
}
