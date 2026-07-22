export const COMMAND_REGISTRATION_MESSAGE_TYPE = 'command-registration'
export const CALENDAR_SYNC_MESSAGE_TYPE = 'calendar-sync'
export const COMMAND_REGISTRATION_ACTIONS = [
  'view',
  'register',
  'clear',
  'delete',
  'rename',
] as const

export type CommandRegistrationAction = (typeof COMMAND_REGISTRATION_ACTIONS)[number]

export interface CommandRegistrationSummary {
  localAndRemote: string[]
  localOnly: string[]
  remoteOnly: string[]
}

export interface CommandRegistrationRequest {
  type: typeof COMMAND_REGISTRATION_MESSAGE_TYPE
  kind: 'request'
  requestId: string
  action: CommandRegistrationAction
  args: string[]
}

export interface CommandRegistrationResult {
  type: typeof COMMAND_REGISTRATION_MESSAGE_TYPE
  kind: 'result'
  requestId: string
  success: boolean
  error?: string
  commands?: CommandRegistrationSummary
}

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

export function isCommandRegistrationRequest(
  message: unknown,
): message is CommandRegistrationRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === COMMAND_REGISTRATION_MESSAGE_TYPE &&
    'kind' in message &&
    message.kind === 'request' &&
    'requestId' in message &&
    typeof message.requestId === 'string' &&
    'action' in message &&
    typeof message.action === 'string' &&
    COMMAND_REGISTRATION_ACTIONS.includes(message.action as CommandRegistrationAction) &&
    'args' in message &&
    Array.isArray(message.args) &&
    message.args.every((arg) => typeof arg === 'string')
  )
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

function isCommandRegistrationSummary(message: unknown): message is CommandRegistrationSummary {
  return (
    typeof message === 'object' &&
    message !== null &&
    'localAndRemote' in message &&
    Array.isArray(message.localAndRemote) &&
    message.localAndRemote.every((command) => typeof command === 'string') &&
    'localOnly' in message &&
    Array.isArray(message.localOnly) &&
    message.localOnly.every((command) => typeof command === 'string') &&
    'remoteOnly' in message &&
    Array.isArray(message.remoteOnly) &&
    message.remoteOnly.every((command) => typeof command === 'string')
  )
}

export function isCommandRegistrationResult(
  message: unknown,
): message is CommandRegistrationResult {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === COMMAND_REGISTRATION_MESSAGE_TYPE &&
    'kind' in message &&
    message.kind === 'result' &&
    'requestId' in message &&
    typeof message.requestId === 'string' &&
    'success' in message &&
    typeof message.success === 'boolean' &&
    (!('error' in message) || typeof message.error === 'string') &&
    (!('commands' in message) || isCommandRegistrationSummary(message.commands))
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
