import { type Client } from 'discord.js'
import { type Request, type Response, Router } from 'express'

import { type Controller } from './index.js'
import { type GetGuildsResponse } from '../models/bot-api/index.js'

export class GuildsController implements Controller {
  public path = '/guilds'
  public router: Router = Router()
  public authToken: string = process.env.DISCORD_BOT_API_SECRET

  constructor(private client: Client) {}

  public register(): void {
    this.router.get('/', (req, res) => this.getGuilds(req, res))
  }

  private async getGuilds(req: Request, res: Response): Promise<void> {
    const resBody: GetGuildsResponse = {
      guilds: [...this.client.guilds.cache.keys()],
    }
    res.status(200).json(resBody)
  }
}
