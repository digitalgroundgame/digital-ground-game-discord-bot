import { type ShardingManager } from 'discord.js'
import { type Request, type Response, Router } from 'express'

import { type Controller } from './index.js'
import { type GetGuildsResponse } from '../models/cluster-api/index.js'

export class GuildsController implements Controller {
  public path = '/guilds'
  public router: Router = Router()
  public requiresAuth = true
  // Validated in manager mode; an empty token fails closed in checkAuth.
  public authToken: string = process.env.DISCORD_BOT_API_SECRET ?? ''

  constructor(private shardManager: ShardingManager) {}

  public register(): void {
    this.router.get('/', (req, res) => this.getGuilds(req, res))
  }

  private async getGuilds(req: Request, res: Response): Promise<void> {
    const guilds: string[] = [
      ...new Set(
        (await this.shardManager.broadcastEval((client) => [...client.guilds.cache.keys()])).flat(),
      ),
    ]

    const resBody: GetGuildsResponse = {
      guilds,
    }
    res.status(200).json(resBody)
  }
}
