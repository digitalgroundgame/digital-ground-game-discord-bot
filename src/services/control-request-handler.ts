import {
  type CalendarSyncRequest,
  type CalendarSyncResult,
  isCalendarSyncRequest,
} from '../models/control-api/calendar-sync.js'
import {
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
  type CommandRegistrationErrorCode,
  type CommandRegistrationRequest,
  type CommandRegistrationResult,
  type CommandRegistrationSummary,
  isCommandRegistrationRequest,
} from '../models/control-api/command-registration.js'
import { CalendarSyncInProgressError, type CalendarSyncRunner } from './calendar-sync-runner.js'
import { Logger } from './logger.js'
import { SingleFlight } from './single-flight.js'

export type ControlRequestResult = CommandRegistrationResult | CalendarSyncResult

type SendResult = (result: ControlRequestResult) => Promise<void>
type RegisterCommands = (args: string[]) => Promise<CommandRegistrationSummary>

export class ControlRequestHandler {
  private commandRegistrationSingleFlight = new SingleFlight()

  public constructor(
    private sendResult: SendResult,
    private registerCommands: RegisterCommands,
    private calendarSyncRunner: Pick<CalendarSyncRunner, 'run'>,
  ) {}

  public async handle(message: unknown): Promise<void> {
    if (isCommandRegistrationRequest(message)) {
      await this.handleCommandRegistrationRequest(message)
      return
    }

    if (isCalendarSyncRequest(message)) {
      await this.handleCalendarSyncRequest(message)
    }
  }

  private async handleCommandRegistrationRequest(
    message: CommandRegistrationRequest,
  ): Promise<void> {
    const release = this.commandRegistrationSingleFlight.acquire()
    if (!release) {
      Logger.warn('Ignoring command registration request because one is already in progress.')
      await this.sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: 'A command registration operation is already in progress.',
        errorCode: 'in-progress',
      })
      return
    }

    Logger.info('Received command registration request from the shard manager.')
    try {
      const commands = await this.registerCommands([
        'node',
        'start-bot',
        'commands',
        message.action,
        ...message.args,
      ])
      Logger.info('Command registration request completed successfully.')
      await this.sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: true,
        ...(message.action === 'view' ? { commands } : {}),
      })
    } catch (error) {
      await Logger.error('Command registration request failed.', error)
      await this.sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        ...this.getCommandRegistrationErrorCode(error),
      })
    } finally {
      release()
    }
  }

  private async handleCalendarSyncRequest(message: CalendarSyncRequest): Promise<void> {
    Logger.info('Received calendar sync request from the shard manager.')
    try {
      await this.calendarSyncRunner.run()
      await this.sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: true,
      })
    } catch (error) {
      await Logger.error('Calendar sync request failed.', error)
      await this.sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        busy: error instanceof CalendarSyncInProgressError,
      })
    }
  }

  private getCommandRegistrationErrorCode(
    error: unknown,
  ): { errorCode: CommandRegistrationErrorCode } | Record<string, never> {
    if (error instanceof CommandRegistrationNotFoundError) {
      return { errorCode: 'not-found' }
    }
    if (error instanceof CommandRegistrationInvalidArgumentError) {
      return { errorCode: 'invalid-argument' }
    }
    return {}
  }
}
