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
  private readonly port: number

  constructor(public controllers: Controller[]) {
    const portOverride = process.env.PORT

    if (portOverride && !/^\d+$/.test(portOverride)) {
      throw new Error(`Invalid PORT: '${portOverride}'`)
    }

    const parsedPort = Number(portOverride)
    if (portOverride && (parsedPort < 1 || parsedPort > 65535)) {
      throw new Error(`Invalid PORT: '${portOverride}'`)
    }

    this.port = parsedPort || Config.api.port
    this.app = express()
    this.app.use(express.json())
    this.setupControllers()
    this.app.use(handleError())
  }

  public async start(): Promise<void> {
    const listen = util.promisify(this.app.listen.bind(this.app))

    await listen(this.port)
    Logger.info(Logs.info.apiStarted.replaceAll('{PORT}', String(this.port)))
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
