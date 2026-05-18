import { ShardingManager } from 'discord.js'
import { createRequire } from 'node:module'
import 'reflect-metadata'

import {
  type Controller,
  GoogleOAuthController,
  GuildsController,
  IntegrationsController,
  RootController,
  ShardsController,
} from './controllers/index.js'
import { createDatabase } from './database/index.js'
import { type Integration, PragmaticPapersIntegration } from './integrations/index.js'
import { type Job } from './jobs/index.js'
import { Api } from './models/api.js'
import { Manager } from './models/manager.js'
import {
  GoogleGroupsService,
  GoogleOAuthService,
  HttpService,
  JobService,
  Logger,
  MasterApiService,
  UserService,
} from './services/index.js'
import { MathUtils, ShardUtils } from './utils/index.js'

const require = createRequire(import.meta.url)
const Config = require('../config/config.json')
const Debug = require('../config/debug.json')
const Logs = require('../lang/logs.json')

async function start(): Promise<void> {
  Logger.info(Logs.info.appStarted)

  // Dependencies
  const httpService = new HttpService()
  const masterApiService = new MasterApiService(httpService)
  if (Config.clustering.enabled) {
    await masterApiService.register()
  }

  // Sharding
  let shardList: number[]
  let totalShards: number
  try {
    if (Config.clustering.enabled) {
      const resBody = await masterApiService.login()
      shardList = resBody.shardList
      const requiredShards = await ShardUtils.requiredShardCount(process.env.DISCORD_BOT_TOKEN)
      totalShards = Math.max(requiredShards, resBody.totalShards)
    } else {
      const recommendedShards = await ShardUtils.recommendedShardCount(
        process.env.DISCORD_BOT_TOKEN,
        Config.sharding.serversPerShard,
      )
      shardList = MathUtils.range(0, recommendedShards)
      totalShards = recommendedShards
    }
  } catch (error) {
    Logger.error(Logs.error.retrieveShards, error)
    return
  }

  if (shardList.length === 0) {
    Logger.warn(Logs.warn.managerNoShards)
    return
  }

  const shardManager = new ShardingManager('dist/start-bot.js', {
    token: process.env.DISCORD_BOT_TOKEN,
    mode: Debug.override.shardMode.enabled ? Debug.override.shardMode.value : 'process',
    respawn: true,
    totalShards,
    shardList,
  })

  // Jobs
  const jobs = [
    // Config.clustering.enabled ? undefined : new UpdateServerCountJob(shardManager, httpService),
    // TODO: Add new jobs here
  ].filter(Boolean) as Job[]

  const manager = new Manager(shardManager, new JobService(jobs))

  // API
  const guildsController = new GuildsController(shardManager)
  const shardsController = new ShardsController(shardManager)
  const rootController = new RootController()
  const integrations: Integration[] = [new PragmaticPapersIntegration()]
  const integrationsController = new IntegrationsController(integrations, shardManager)

  const controllers: Controller[] = [
    guildsController,
    shardsController,
    integrationsController,
    rootController,
  ]

  // Google Group sign-in callback (used by the /google-add command)
  const googleOAuthService = new GoogleOAuthService(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  )
  const googleGroupsService = new GoogleGroupsService(
    process.env.GOOGLE_CALENDAR_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_WORKSPACE_ADMIN_SUBJECT,
  )
  if (googleOAuthService.isConfigured() && googleGroupsService.isConfigured()) {
    const userService = new UserService(createDatabase())
    controllers.push(
      new GoogleOAuthController(googleOAuthService, googleGroupsService, userService),
    )
  } else {
    Logger.warn(
      'Google Group management is not fully configured; /google-add callback endpoint will not be registered. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI, the service account credentials, and GOOGLE_WORKSPACE_ADMIN_SUBJECT.',
    )
  }

  const api = new Api(controllers)

  // Start
  await manager.start()
  await api.start()
  if (Config.clustering.enabled) {
    await masterApiService.ready()
  }
}

process.on('unhandledRejection', (reason, _promise) => {
  Logger.error(Logs.error.unhandledRejection, reason)
})

start().catch((error) => {
  Logger.error(Logs.error.unspecified, error)
})
