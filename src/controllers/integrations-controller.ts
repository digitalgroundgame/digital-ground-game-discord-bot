import { type ShardingManager } from 'discord.js'
import { type Request, type Response, Router } from 'express'

import { type Controller } from './index.js'
import { type Integration } from '../integrations/index.js'
import { checkAuth } from '../middleware/index.js'
import { Logger } from '../services/index.js'

export class IntegrationsController implements Controller {
  public path = '/integrations'
  public router: Router = Router()

  constructor(
    private integrations: Integration[],
    private shardManager: ShardingManager,
  ) {}

  public register(): void {
    for (const integration of this.integrations) {
      const envVar = IntegrationsController.envVarFor(integration.name)
      const apiKey = process.env[envVar]
      if (!apiKey) {
        Logger.warn(
          `Integration '${integration.name}' has no API key configured (expected env var '${envVar}'); endpoint will not be registered.`,
        )
        continue
      }
      this.router.post(
        integration.endpoint,
        checkAuth(apiKey),
        (req: Request, res: Response) => integration.run(req, res, this.shardManager),
      )
    }
  }

  private static envVarFor(name: string): string {
    const slug = name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    return `INTEGRATION_${slug}`
  }
}
