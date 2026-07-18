import { type Request, type Response, Router } from 'express'

import { CalendarSyncInProgressError } from '../services/calendar-sync-control-service.js'

import { type Controller } from './index.js'

export interface CalendarSyncControllerService {
  sync(): Promise<void>
}

export class CalendarController implements Controller {
  public path = '/calendar'
  public router: Router = Router()

  public constructor(private calendarSyncControlService: CalendarSyncControllerService) {}

  public register(): void {
    this.router.post('/sync', (req, res) => this.sync(req, res))
  }

  private async sync(_req: Request, res: Response): Promise<void> {
    try {
      await this.calendarSyncControlService.sync()
      res.status(200).json({ action: 'sync', success: true })
    } catch (error) {
      if (error instanceof CalendarSyncInProgressError) {
        res.status(409).json({ error: error.message })
        return
      }

      res.status(503).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}
