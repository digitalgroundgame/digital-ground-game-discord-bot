import express, { type Express } from 'express'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import util from 'node:util'

import { type Controller } from '../controllers/index.js'
import { checkAuth, handleError } from '../middleware/index.js'
import { Logger } from '../services/index.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')
const Logs = require('../../lang/logs.json')
const defaultControlSocketPath = '/tmp/dggac-bot/control.sock'

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

  public async startUnixSocket(): Promise<void> {
    const socketPath = defaultControlSocketPath
    await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(socketPath), 0o700)

    try {
      const existingSocket = await lstat(socketPath)
      if (!existingSocket.isSocket()) {
        throw new Error(`Refusing to replace non-socket control path: ${socketPath}`)
      }
      await unlink(socketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    const server = this.app.listen(socketPath)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    await chmod(socketPath, 0o600)
    Logger.info(`Local control API listening on Unix socket ${socketPath}.`)
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
