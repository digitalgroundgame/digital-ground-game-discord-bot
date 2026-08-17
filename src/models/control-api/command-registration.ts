export const COMMAND_REGISTRATION_MESSAGE_TYPE = 'command-registration'
export const COMMAND_REGISTRATION_ACTIONS = [
  'view',
  'register',
  'clear',
  'delete',
  'rename',
] as const

export type CommandRegistrationAction = (typeof COMMAND_REGISTRATION_ACTIONS)[number]

export const COMMAND_REGISTRATION_ERROR_CODES = [
  'invalid-argument',
  'not-found',
  'in-progress',
] as const

export type CommandRegistrationErrorCode = (typeof COMMAND_REGISTRATION_ERROR_CODES)[number]

export class CommandRegistrationInvalidArgumentError extends Error {
  public override readonly name = 'CommandRegistrationInvalidArgumentError'
}

export class CommandRegistrationNotFoundError extends Error {
  public override readonly name = 'CommandRegistrationNotFoundError'
}

export class CommandRegistrationInProgressError extends Error {
  public override readonly name = 'CommandRegistrationInProgressError'

  public constructor() {
    super('A command registration operation is already in progress.')
  }
}

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
  errorCode?: CommandRegistrationErrorCode
  commands?: CommandRegistrationSummary
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
    (!('errorCode' in message) ||
      (typeof message.errorCode === 'string' &&
        COMMAND_REGISTRATION_ERROR_CODES.includes(
          message.errorCode as CommandRegistrationErrorCode,
        ))) &&
    (!('commands' in message) || isCommandRegistrationSummary(message.commands))
  )
}
