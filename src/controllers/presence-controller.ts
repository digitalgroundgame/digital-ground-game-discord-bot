import { type Request, type Response, Router } from 'express'

import { type Controller } from './index.js'
import { type CustomClient } from '../extensions/index.js'
import { mapClass } from '../middleware/index.js'
import { PresenceActivityTypes, SetPresenceRequest } from '../models/bot-api/index.js'

export class PresenceController implements Controller {
  public path = '/presence'
  public router: Router = Router()
  public authToken: string = process.env.DISCORD_BOT_API_SECRET

  constructor(private client: CustomClient) {}

  public register(): void {
    this.router.put('/', mapClass(SetPresenceRequest), (req, res) => this.setPresence(req, res))
  }

  private async setPresence(_req: Request, res: Response): Promise<void> {
    const reqBody: SetPresenceRequest = res.locals.input
    this.client.setPresence(PresenceActivityTypes[reqBody.type], reqBody.name, reqBody.url)
    res.sendStatus(200)
  }
}
