import { type ShardingManager } from 'discord.js'
import { type Request, type Response, Router } from 'express'
import { createRequire } from 'node:module'

import { type Controller } from './index.js'
import { type CustomClient } from '../extensions/index.js'
import { type GetUserResponse } from '../models/cluster-api/index.js'
import { Logger } from '../services/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

export class UsersController implements Controller {
  public path = '/users'
  public router: Router = Router()
  public authToken: string = Config.api.secret

  constructor(private shardManager: ShardingManager) {}

  public register(): void {
    this.router.get('/:userId', (req, res) => this.getUser(req, res))
  }

  private async getUser(req: Request, res: Response): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID
    if (!guildId) {
      Logger.error('DISCORD_GUILD_ID is not set; cannot resolve user info.')
      res.sendStatus(500)
      return
    }

    const userId = req.params.userId
    if (typeof userId !== 'string' || userId.length === 0) {
      res.sendStatus(400)
      return
    }

    const results = await this.shardManager.broadcastEval(
      (client, context) => (client as CustomClient).getUserInfo(context.guildId, context.userId),
      { context: { guildId, userId } },
    )

    const user = results.find(Boolean) as GetUserResponse | undefined
    if (!user) {
      res.sendStatus(404)
      return
    }

    res.status(200).json(user)
  }
}
