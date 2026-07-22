import { REST } from '@discordjs/rest'
import { Options, Partials, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js'
import { createRequire } from 'node:module'
import { parentPort } from 'node:worker_threads'

import { type Button } from './buttons/index.js'
import {
  isCalendarSyncRequest,
  isCommandRegistrationRequest,
  type CalendarSyncResult,
  type CommandRegistrationResult,
  type CommandRegistrationSummary,
} from './command-registration-control.js'
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
  CalendarSyncInProgressError,
  CalendarSyncRunner,
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

function getLocalCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
  return [
    ...Object.values(ChatCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
    ...Object.values(MessageCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
    ...Object.values(UserCommandMetadata).sort((a, b) => (a.name > b.name ? 1 : -1)),
  ]
}

async function registerCommands(args: string[]): Promise<CommandRegistrationSummary> {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN)
  const commandRegistrationService = new CommandRegistrationService(rest)
  return await commandRegistrationService.process(getLocalCommands(), args)
}

async function start(): Promise<void> {
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

  let commandRegistrationInProgress = false
  const handleCommandRegistrationRequest = async (message: unknown): Promise<void> => {
    if (!isCommandRegistrationRequest(message)) {
      return
    }

    const sendResult = async (result: CommandRegistrationResult): Promise<void> => {
      if (!client.shard) {
        return
      }

      try {
        await client.shard.send(result)
      } catch (error) {
        await Logger.error('Unable to report command registration result to the manager.', error)
      }
    }

    if (commandRegistrationInProgress) {
      Logger.warn('Ignoring command registration request because one is already in progress.')
      await sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: 'A command registration is already in progress.',
      })
      return
    }

    commandRegistrationInProgress = true
    Logger.info('Received command registration request from the shard manager.')
    try {
      const commands = await registerCommands([
        'node',
        'start-bot',
        'commands',
        message.action,
        ...message.args,
      ])
      Logger.info('Command registration request completed successfully.')
      await sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: true,
        ...(message.action === 'view' ? { commands } : {}),
      })
    } catch (error) {
      await Logger.error('Command registration request failed.', error)
      await sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      commandRegistrationInProgress = false
    }
  }
  process.on('message', (message) => {
    void handleCommandRegistrationRequest(message)
  })
  parentPort?.on('message', (message) => {
    void handleCommandRegistrationRequest(message)
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
  const calendarSyncRunner = new CalendarSyncRunner(async (): Promise<void> => {
    await syncDggpScheduledEventsToGoogle(client, googleCalendarService)
  })
  const handleCalendarSyncRequest = async (message: unknown): Promise<void> => {
    if (!isCalendarSyncRequest(message)) {
      return
    }

    const sendResult = async (result: CalendarSyncResult): Promise<void> => {
      if (!client.shard) {
        return
      }

      try {
        await client.shard.send(result)
      } catch (error) {
        await Logger.error('Unable to report calendar sync result to the manager.', error)
      }
    }

    Logger.info('Received calendar sync request from the shard manager.')
    try {
      await calendarSyncRunner.run()
      await sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: true,
      })
    } catch (error) {
      await Logger.error('Calendar sync request failed.', error)
      await sendResult({
        type: message.type,
        kind: 'result',
        requestId: message.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        busy: error instanceof CalendarSyncInProgressError,
      })
    }
  }
  process.on('message', (message) => {
    void handleCalendarSyncRequest(message)
  })
  parentPort?.on('message', (message) => {
    void handleCalendarSyncRequest(message)
  })
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
    new SyncDggpGoogleCalendarJob(calendarSyncRunner),
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
        await calendarSyncRunner.run()
      } catch (error) {
        if (error instanceof CalendarSyncInProgressError) {
          Logger.info(
            'Calendar sync: startup sync skipped because another sync is already in progress.',
          )
          return
        }

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
