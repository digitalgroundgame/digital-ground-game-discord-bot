import { type ShardingManager } from 'discord.js'
import { type Request, type Response } from 'express'

export interface Integration {
  name: string
  endpoint: string
  run(req: Request, res: Response, shardManager: ShardingManager): Promise<void>
}
