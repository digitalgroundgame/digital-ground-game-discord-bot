import { type Request, type Response, Router } from 'express'

import {
  type CommandRegistrationAction,
  type CommandRegistrationSummary,
} from '../command-registration-control.js'
import { CommandRegistrationInProgressError } from '../services/command-registration-control-service.js'

import { type Controller } from './index.js'

export interface CommandRegistrationControllerService {
  request(action: CommandRegistrationAction, args?: string[]): Promise<CommandRegistrationSummary | undefined>
}

export class CommandsController implements Controller {
  public path = '/commands'
  public router: Router = Router()

  public constructor(private commandRegistrationControlService: CommandRegistrationControllerService) {}

  public register(): void {
    this.router.get('/', (req, res) => this.run(req, res, 'view'))
    this.router.post('/register', (req, res) => this.run(req, res, 'register'))
    this.router.delete('/', (req, res) => this.clear(req, res))
    this.router.delete('/:name', (req, res) => this.delete(req, res))
    this.router.patch('/:name', (req, res) => this.rename(req, res))
  }

  private async clear(req: Request, res: Response): Promise<void> {
    if (req.body?.confirm !== true) {
      res.status(400).json({ error: 'Set {"confirm": true} to clear every Discord command.' })
      return
    }

    await this.run(req, res, 'clear')
  }

  private async delete(req: Request, res: Response): Promise<void> {
    const name = req.params.name
    if (typeof name !== 'string' || name.length === 0) {
      res.status(400).json({ error: 'Provide the command name to delete.' })
      return
    }

    await this.run(req, res, 'delete', [name])
  }

  private async rename(req: Request, res: Response): Promise<void> {
    const currentName = req.params.name
    const replacementName = req.body?.name
    if (
      typeof currentName !== 'string' ||
      currentName.length === 0 ||
      typeof replacementName !== 'string' ||
      replacementName.length === 0
    ) {
      res.status(400).json({ error: 'Provide the replacement command name as {"name":"..."}.' })
      return
    }

    await this.run(req, res, 'rename', [currentName, replacementName])
  }

  private async run(
    _req: Request,
    res: Response,
    action: CommandRegistrationAction,
    args: string[] = [],
  ): Promise<void> {
    try {
      const commands = await this.commandRegistrationControlService.request(action, args)
      res.status(200).json({ action, success: true, ...(commands ? { commands } : {}) })
    } catch (error) {
      if (error instanceof CommandRegistrationInProgressError) {
        res.status(409).json({ error: error.message })
        return
      }

      res.status(503).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}
