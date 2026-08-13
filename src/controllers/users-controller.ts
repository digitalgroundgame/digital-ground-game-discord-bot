import { type ShardingManager } from 'discord.js'
import { type Request, type Response, Router } from 'express'

import { type Controller } from './index.js'
import { type CustomClient } from '../extensions/index.js'
import { type GetUserResponse } from '../models/cluster-api/index.js'
import { Logger } from '../services/index.js'

const SNOWFLAKE_PATTERN = /^\d{17,20}$/

export class UsersController implements Controller {
  public path = '/users'
  public router: Router = Router()
  public requiresAuth = true
  public authToken: string = process.env.DISCORD_BOT_API_SECRET

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

    // Must be a snowflake: `getUserInfo` resolves the id through
    // `ClientUtils.findMember`, which falls back to a display-name search for
    // non-id input and would otherwise return an arbitrary member's data.
    const userId = req.params.userId
    if (typeof userId !== 'string' || !SNOWFLAKE_PATTERN.test(userId)) {
      res.sendStatus(400)
      return
    }

    let results: (GetUserResponse | null)[]
    try {
      results = await this.shardManager.broadcastEval(
        (client, context) => (client as CustomClient).getUserInfo(context.guildId, context.userId),
        { context: { guildId, userId } },
      )
    } catch (err: unknown) {
      // A shard being unready (respawn) or a DB error rejects the whole call.
      // 503 tells the caller to retry and keeps internal error text off the wire.
      Logger.error(`/users: failed to resolve ${userId} across shards`, err)
      res.sendStatus(503)
      return
    }

    const user = results.find(Boolean) as GetUserResponse | undefined
    if (!user) {
      if (results.length > 0 && results.every((result) => result === null)) {
        // Also the shape of a misconfigured DISCORD_GUILD_ID: no shard has the
        // guild, which is indistinguishable from "not a member" to the caller.
        Logger.warn(`/users: no shard resolved ${userId} in guild ${guildId}`)
      }
      res.sendStatus(404)
      return
    }

    res.status(200).json(user)
  }
}
