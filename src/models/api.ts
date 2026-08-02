import express, { type Express } from 'express'
import { createRequire } from 'node:module'
import util from 'node:util'

import { type Controller } from '../controllers/index.js'
import { checkAuth, handleError } from '../middleware/index.js'
import { Logger } from '../services/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')
const Logs = require('../../lang/logs.json')

export class Api {
  public app: Express

  constructor(public controllers: Controller[]) {
    this.app = express()
    this.app.use(express.json())
    this.setupControllers()
    this.app.use(handleError())
  }

  public async start(): Promise<void> {
    const listen = util.promisify(this.app.listen.bind(this.app))
    const port = Number(process.env.PORT) || Config.api.port
    await listen(port)
    Logger.info(Logs.info.apiStarted.replaceAll('{PORT}', String(port)))
  }

  private setupControllers(): void {
    for (const controller of this.controllers) {
      if (controller.requiresAuth) {
        if (!controller.authToken) {
          throw new Error(
            `Controller '${controller.path}' requires an auth token but none is configured; refusing to mount it unauthenticated.`,
          )
        }
        controller.router.use(checkAuth(controller.authToken))
      }
      controller.register()
      this.app.use(controller.path, controller.router)
    }
  }
}
