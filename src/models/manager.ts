import { type Shard, type ShardingManager } from 'discord.js'
import { createRequire } from 'node:module'

import { type JobService, Logger } from '../services/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')
const Debug = require('../../config/debug.json')
const Logs = require('../../lang/logs.json')

export class Manager {
  constructor(
    private shardManager: ShardingManager,
    private jobService: JobService,
  ) {}

  public async start(): Promise<void> {
    this.registerListeners()

    const shardList = this.shardManager.shardList as number[]

    try {
      Logger.info(
        Logs.info.managerSpawningShards
          .replaceAll('{SHARD_COUNT}', shardList.length.toLocaleString())
          .replaceAll('{SHARD_LIST}', shardList.join(', ')),
      )
      await this.shardManager.spawn({
        amount: this.shardManager.totalShards,
        delay: Config.sharding.spawnDelay * 1000,
        timeout: Config.sharding.spawnTimeout * 1000,
      })
      Logger.info(Logs.info.managerAllShardsSpawned)
    } catch (error) {
      Logger.error(Logs.error.managerSpawningShards, error)
      // Kill any shards that did spawn so the process can exit instead of
      // lingering with a partial fleet. Disable respawn first, or discord.js
      // re-forks each dying child mid-teardown. kill() can throw on a shard
      // caught mid-respawn (no process or worker attached yet); keep going so
      // one bad shard doesn't leave the rest alive or mask the spawn error.
      this.shardManager.respawn = false
      for (const shard of this.shardManager.shards.values()) {
        try {
          shard.kill()
        } catch (killError) {
          Logger.error(Logs.error.unspecified, killError)
        }
      }
      throw error
    }

    if (Debug.dummyMode.enabled) {
      return
    }

    this.jobService.start()
  }

  private registerListeners(): void {
    this.shardManager.on('shardCreate', (shard) => this.onShardCreate(shard))
  }

  private onShardCreate(shard: Shard): void {
    Logger.info(Logs.info.managerLaunchedShard.replaceAll('{SHARD_ID}', shard.id.toString()))
  }
}
