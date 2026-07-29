import { type Client } from 'discord.js'
import { type Request, type Response } from 'express'

export interface Integration {
  name: string
  endpoint: string
  run(req: Request, res: Response, client: Client): Promise<void>
}
