import { REST } from '@discordjs/rest'
import { Options, Partials } from 'discord.js'
import { createRequire } from 'node:module'

import { type Button } from './buttons/index.js'
import { runCalendarSyncCli } from './calendar-sync-cli.js'
import {
  AttendanceTrackCommand,
  CensusCommand,
  ContentCommand,
  DevCommand,
  GrantAccessCommand,
  HelpCommand,
  InfoCommand,
  LinkAccountCommand,
  PragPapersCommand,
  RulesCommand,
  StopAttendanceTrackCommand,
  TestCommand,
} from './commands/chat/index.js'
import {
  ChatCommandMetadata,
  MessageCommandMetadata,
  UserCommandMetadata,
  type Command,
} from './commands/index.js'
import { ONBOARDING_CONFIGS, SendOnboarding } from './commands/user/index.js'
import { createDatabase, type Database } from './database/index.js'
import {
  ButtonHandler,
  CommandHandler,
  GuildJoinHandler,
  GuildLeaveHandler,
  GuildMemberAddHandler,
  GuildMemberUpdateHandler,
  GuildScheduledEventHandler,
  MessageHandler,
  ReactionHandler,
  TriggerHandler,
  VoiceStateUpdateHandler,
} from './events/index.js'
import { CustomClient } from './extensions/index.js'
import { AutoCloseWelcomeThreadsJob, SyncDggpGoogleCalendarJob, type Job } from './jobs/index.js'
import { Bot } from './models/bot.js'
import { type Reaction } from './reactions/index.js'
import { syncDggpScheduledEventsToGoogle } from './services/sync-dggp-google-calendar.js'
import {
  AttendanceService,
  CommandRegistrationService,
  ContentService,
  CrmService,
  EventDataService,
  GoogleCalendarService,
  GoogleGroupsService,
  JobService,
  Logger,
  UserService,
} from './services/index.js'
import { CTAPostTrigger } from './triggers/cta-post.js'
import { type Trigger } from './triggers/index.js'

const require = createRequire(import.meta.url)
const Config = require('../config/config.json')
const Logs = require('../lang/logs.json')

async function start(): Promise<void> {
  if (process.argv[2] === 'calendar' && process.argv[3] === 'sync') {
    try {
      await runCalendarSyncCli()
    } catch (error) {
      Logger.error(Logs.error.unspecified, error)
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    process.exit(0)
  }

  // Register
  if (process.argv[2] == 'commands') {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN)
      const commandRegistrationService = new CommandRegistrationService(rest)
      const localCmds = [
        ...Object.values(ChatCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
        ...Object.values(MessageCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
        ...Object.values(UserCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
      ]
      await commandRegistrationService.process(localCmds, process.argv)
    } catch (error) {
      Logger.error(Logs.error.commandAction, error)
    }
    // Wait for any final logs to be written.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    process.exit()
  }

  // Services
  const eventDataService = new EventDataService()
  const attendanceService = new AttendanceService()
  const crmService = new CrmService()

  // Client
  const client = new CustomClient({
    intents: Config.client.intents,
    partials: (Config.client.partials as string[]).map((partial) => Partials[partial]),
    makeCache: Options.cacheWithLimits({
      // Keep default caching behavior
      ...Options.DefaultMakeCacheSettings,
      // Override specific options from config
      ...Config.client.caches,
    }),
    enforceNonce: true,
  })

  // Service account used by /grant-access to manage Google Group membership.
  const googleGroupsService = new GoogleGroupsService(
    process.env.GOOGLE_CALENDAR_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_WORKSPACE_ADMIN_SUBJECT ?? process.env.GOOGLE_CALENDAR_IMPERSONATION_SUBJECT,
  )
  if (!googleGroupsService.isConfigured()) {
    Logger.warn(
      '/grant-access: disabled — set GOOGLE_APPLICATION_CREDENTIALS (or GOOGLE_CALENDAR_CREDENTIALS) and GOOGLE_WORKSPACE_ADMIN_SUBJECT (or GOOGLE_CALENDAR_IMPERSONATION_SUBJECT) — the Workspace admin email the service account impersonates. /link-account remains available.',
    )
  }
  let database: Database | undefined
  if (process.env.SQLITE_PATH) {
    try {
      database = createDatabase()
    } catch (error) {
      Logger.error(
        'Failed to initialize the database; /link-account and /grant-access will be unavailable, and /content edits will not persist.',
        error,
      )
    }
  }
  // Stores the external accounts members link via /link-account, and is read
  // by /grant-access to resolve a member's Google email.
  const userService = database ? new UserService(database) : undefined
  // Resolves runtime-editable content. Always available — without a database
  // it serves the registry defaults and rejects edits.
  const contentService = new ContentService(database)

  const voiceStateUpdateHandler = new VoiceStateUpdateHandler(attendanceService, crmService, client)

  // Commands
  const commands: Command[] = [
    // Chat Commands
    new DevCommand(),
    new HelpCommand(),
    new InfoCommand(),
    new TestCommand(),
    new RulesCommand(),
    new PragPapersCommand(),
    new CensusCommand(),
    new AttendanceTrackCommand(attendanceService, crmService),
    new StopAttendanceTrackCommand(attendanceService, voiceStateUpdateHandler),
    new GrantAccessCommand(googleGroupsService, userService),
    new LinkAccountCommand(userService),
    new ContentCommand(contentService),

    // User Context Commands
    ...ONBOARDING_CONFIGS.map((config) => new SendOnboarding(config, contentService)),
  ]

  // Buttons
  const buttons: Button[] = [
    // TODO: Add new buttons here
  ]

  // Reactions
  const reactions: Reaction[] = [
    // TODO: Add new reactions here
  ]

  // Triggers
  const triggers: Trigger[] = [
    // TODO: Add new triggers here
    new CTAPostTrigger(),
  ]

  // Google Calendar sync — service account JSON key path
  const googleCalendarService = new GoogleCalendarService(
    process.env.GOOGLE_CALENDAR_ID,
    process.env.GOOGLE_CALENDAR_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_CALENDAR_IMPERSONATION_SUBJECT,
  )
  // Event handlers
  const guildJoinHandler = new GuildJoinHandler(eventDataService)
  const guildLeaveHandler = new GuildLeaveHandler()
  const guildMemberAddHandler = new GuildMemberAddHandler(contentService)
  const guildMemberUpdateHandler = new GuildMemberUpdateHandler([])
  const commandHandler = new CommandHandler(commands, eventDataService)
  const buttonHandler = new ButtonHandler(buttons, eventDataService)
  const triggerHandler = new TriggerHandler(triggers, eventDataService)
  const messageHandler = new MessageHandler(triggerHandler)
  const reactionHandler = new ReactionHandler(reactions, eventDataService)
  const guildScheduledEventHandler = new GuildScheduledEventHandler(googleCalendarService)

  // Jobs
  const jobs: Job[] = [
    new AutoCloseWelcomeThreadsJob(client),
    new SyncDggpGoogleCalendarJob(client, googleCalendarService),
  ]

  // Bot
  const bot = new Bot(
    process.env.DISCORD_BOT_TOKEN,
    client,
    guildJoinHandler,
    guildLeaveHandler,
    guildMemberAddHandler,
    guildMemberUpdateHandler,
    messageHandler,
    commandHandler,
    buttonHandler,
    reactionHandler,
    guildScheduledEventHandler,
    new JobService(jobs),
    voiceStateUpdateHandler,
    // onBotReady callback: run immediate Google Calendar sync once after bot is ready
    async () => {
      try {
        await syncDggpScheduledEventsToGoogle(client, googleCalendarService)
      } catch (error) {
        Logger.error(
          Logs.error.calendarSync.replace('{EVENT_NAME}', 'immediate startup sync'),
          error,
        )
      }
    },
  )

  await bot.start()
}

process.on('unhandledRejection', (reason, _promise) => {
  Logger.error(Logs.error.unhandledRejection, reason)
})

start().catch((error) => {
  Logger.error(Logs.error.unspecified, error)
})
