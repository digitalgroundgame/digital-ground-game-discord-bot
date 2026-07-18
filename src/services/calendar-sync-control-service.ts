import { randomUUID } from 'node:crypto'

import { ShardClientUtil, type ShardingManager, type Shard } from 'discord.js'

import {
  CALENDAR_SYNC_MESSAGE_TYPE,
  isCalendarSyncResult,
  type CalendarSyncRequest,
} from '../command-registration-control.js'

const calendarSyncTimeoutMs = 5 * 60 * 1000

export class CalendarSyncInProgressError extends Error {
  public constructor() {
    super('A calendar sync is already in progress.')
  }
}

export class CalendarSyncControlService {
  private activeRequest:
    | {
        id: string
        timeout: NodeJS.Timeout
        resolve: () => void
        reject: (error: Error) => void
      }
    | undefined

  public constructor(private shardManager: ShardingManager) {
    for (const shard of this.shardManager.shards.values()) {
      shard.on('message', (message) => this.handleShardMessage(message))
    }
  }

  public async sync(): Promise<void> {
    if (this.activeRequest) {
      throw new CalendarSyncInProgressError()
    }

    const shard = this.getCalendarGuildShard()
    const request: CalendarSyncRequest = {
      type: CALENDAR_SYNC_MESSAGE_TYPE,
      kind: 'request',
      requestId: randomUUID(),
    }

    await new Promise<void>((resolve, reject) => {
      this.activeRequest = {
        id: request.requestId,
        timeout: setTimeout(() => {
          this.activeRequest = undefined
          reject(new Error('Timed out while waiting for the shard to complete calendar sync.'))
        }, calendarSyncTimeoutMs),
        resolve,
        reject,
      }

      void shard.send(request).catch((error: unknown) => {
        this.rejectActiveRequest(error)
      })
    })
  }

  private getCalendarGuildShard(): Shard {
    const guildId = process.env.DISCORD_GUILD_ID
    if (!guildId) {
      throw new Error('DISCORD_GUILD_ID is required to run calendar sync.')
    }

    const totalShards = this.shardManager.totalShards
    if (typeof totalShards !== 'number') {
      throw new Error('The Discord shard count is not available.')
    }

    const shardId = ShardClientUtil.shardIdForGuildId(guildId, totalShards)
    const shard = this.shardManager.shards.get(shardId)
    if (!(shard && shard.ready)) {
      throw new Error(`Discord shard ${shardId} for the calendar guild is not ready.`)
    }

    return shard
  }

  private handleShardMessage(message: unknown): void {
    if (!isCalendarSyncResult(message) || message.requestId !== this.activeRequest?.id) {
      return
    }

    if (message.success) {
      this.resolveActiveRequest()
    } else {
      this.rejectActiveRequest(new Error(message.error ?? 'Calendar sync failed.'))
    }
  }

  private resolveActiveRequest(): void {
    const request = this.activeRequest
    if (!request) {
      return
    }

    this.activeRequest = undefined
    clearTimeout(request.timeout)
    request.resolve()
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
