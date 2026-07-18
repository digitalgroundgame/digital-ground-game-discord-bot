import { randomUUID } from 'node:crypto'

import { type ShardingManager } from 'discord.js'

import {
  COMMAND_REGISTRATION_MESSAGE_TYPE,
  isCommandRegistrationResult,
  type CommandRegistrationAction,
  type CommandRegistrationRequest,
  type CommandRegistrationSummary,
} from '../command-registration-control.js'

const commandRegistrationTimeoutMs = 5 * 60 * 1000

export class CommandRegistrationInProgressError extends Error {
  public constructor() {
    super('A command registration operation is already in progress.')
  }
}

export class CommandRegistrationControlService {
  private activeRequest:
    | {
        id: string
        timeout: NodeJS.Timeout
        resolve: (commands: CommandRegistrationSummary | undefined) => void
        reject: (error: Error) => void
      }
    | undefined

  public constructor(private shardManager: ShardingManager) {
    for (const shard of this.shardManager.shards.values()) {
      shard.on('message', (message) => this.handleShardMessage(message))
    }
  }

  public async request(
    action: CommandRegistrationAction,
    args: string[] = [],
  ): Promise<CommandRegistrationSummary | undefined> {
    if (this.activeRequest) {
      throw new CommandRegistrationInProgressError()
    }

    const shard = [...this.shardManager.shards.values()].find((candidate) => candidate.ready)
    if (!shard) {
      throw new Error('No Discord shard is ready to register commands.')
    }

    const request: CommandRegistrationRequest = {
      type: COMMAND_REGISTRATION_MESSAGE_TYPE,
      kind: 'request',
      requestId: randomUUID(),
      action,
      args,
    }

    return await new Promise<CommandRegistrationSummary | undefined>((resolve, reject) => {
      this.activeRequest = {
        id: request.requestId,
        timeout: setTimeout(() => {
          this.activeRequest = undefined
          reject(new Error('Timed out while waiting for the shard to complete command registration.'))
        }, commandRegistrationTimeoutMs),
        resolve,
        reject,
      }

      void shard.send(request).catch((error: unknown) => {
        this.rejectActiveRequest(error)
      })
    })
  }

  private handleShardMessage(message: unknown): void {
    if (!isCommandRegistrationResult(message) || message.requestId !== this.activeRequest?.id) {
      return
    }

    if (message.success) {
      this.resolveActiveRequest(message.commands)
    } else {
      this.rejectActiveRequest(new Error(message.error ?? 'Command registration failed.'))
    }
  }

  private resolveActiveRequest(commands: CommandRegistrationSummary | undefined): void {
    const request = this.activeRequest
    if (!request) {
      return
    }

    this.activeRequest = undefined
    clearTimeout(request.timeout)
    request.resolve(commands)
  }

  private rejectActiveRequest(error: unknown): void {
    const request = this.activeRequest
    if (!request) {
      return
    }

    this.activeRequest = undefined
    clearTimeout(request.timeout)
    request.reject(error instanceof Error ? error : new Error(String(error)))
  }
}
