import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelType,
  type Client,
  CommandInteraction,
  Events,
  type Guild,
  type GuildMember,
  type GuildScheduledEvent,
  type Interaction,
  type Message,
  type MessageReaction,
  type PartialGuildMember,
  type PartialGuildScheduledEvent,
  type PartialMessageReaction,
  type PartialUser,
  type RateLimitData,
  RESTEvents,
  type User,
} from 'discord.js'
import { createRequire } from 'node:module'

import {
  type ButtonHandler,
  type CommandHandler,
  type GuildJoinHandler,
  type GuildLeaveHandler,
  type GuildMemberAddHandler,
  type GuildMemberUpdateHandler,
  type GuildScheduledEventHandler,
  type MessageHandler,
  type ReactionHandler,
  type VoiceStateUpdateHandler,
} from '../events/index.js'
import { type JobService, Logger } from '../services/index.js'
import { DGGP_GUILD_NAME } from '../constants/dggp-guild.js'
import { PartialUtils } from '../utils/index.js'
import { CTAPostTrigger } from '../triggers/cta-post.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')
const Debug = require('../../config/debug.json')
const Logs = require('../../lang/logs.json')
const ctaChannelName = 'call-to-action'
export class Bot {
  private ready = false

  constructor(
    private token: string,
    private client: Client,
    private guildJoinHandler: GuildJoinHandler,
    private guildLeaveHandler: GuildLeaveHandler,
    private guildMemberAddHandler: GuildMemberAddHandler,
    private guildMemberUpdateHandler: GuildMemberUpdateHandler,
    private messageHandler: MessageHandler,
    private commandHandler: CommandHandler,
    private buttonHandler: ButtonHandler,
    private reactionHandler: ReactionHandler,
    private guildScheduledEventHandler: GuildScheduledEventHandler,
    private jobService: JobService,
    private voiceStateUpdateHandler?: VoiceStateUpdateHandler,
  ) {}

  public async start(): Promise<void> {
    this.registerListeners()
    await this.login(this.token)
  }

  private registerListeners(): void {
    this.client.on(Events.ClientReady, () => this.onReady())
    this.client.on(Events.ShardReady, (shardId: number, unavailableGuilds: Set<string>) =>
      this.onShardReady(shardId, unavailableGuilds),
    )
    this.client.on(Events.GuildCreate, (guild: Guild) => this.onGuildJoin(guild))
    this.client.on(Events.GuildDelete, (guild: Guild) => this.onGuildLeave(guild))
    this.client.on(Events.GuildMemberAdd, (member: GuildMember) => this.onGuildMemberAdd(member))
    this.client.on(
      Events.GuildMemberUpdate,
      (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) =>
        this.onGuildMemberUpdate(oldMember, newMember),
    )
    this.client.on(Events.MessageCreate, (msg: Message) => this.onMessage(msg))
    this.client.on(Events.InteractionCreate, (intr: Interaction) => this.onInteraction(intr))
    this.client.on(
      Events.MessageReactionAdd,
      (messageReaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) =>
        this.onReaction(messageReaction, user),
    )
    this.client.on(Events.GuildScheduledEventCreate, (event: GuildScheduledEvent) =>
      this.onGuildScheduledEventCreate(event),
    )
    this.client.on(
      Events.GuildScheduledEventUpdate,
      (
        oldEvent: GuildScheduledEvent | PartialGuildScheduledEvent | null,
        newEvent: GuildScheduledEvent,
      ) => this.onGuildScheduledEventUpdate(oldEvent, newEvent),
    )
    this.client.on(
      Events.GuildScheduledEventDelete,
      (event: GuildScheduledEvent | PartialGuildScheduledEvent) =>
        this.onGuildScheduledEventDelete(event),
    )
    if (this.voiceStateUpdateHandler) {
      this.client.on(
        Events.VoiceStateUpdate,
        (oldState: import('discord.js').VoiceState, newState: import('discord.js').VoiceState) =>
          this.onVoiceStateUpdate(oldState, newState),
      )
    }
    this.client.rest.on(RESTEvents.RateLimited, (rateLimitData: RateLimitData) =>
      this.onRateLimit(rateLimitData),
    )
  }

  private async login(token: string): Promise<void> {
    try {
      await this.client.login(token)
    } catch (error) {
      Logger.error(Logs.error.clientLogin, error)
      return
    }
  }

  private async onReady(): Promise<void> {
    const userTag = this.client.user?.tag

    Logger.info(Logs.info.clientLogin.replaceAll('{USER_TAG}', userTag))

    if (!Debug.dummyMode.enabled) {
      this.jobService.start()
    }

    this.ready = true
    Logger.info(Logs.info.clientReady)

    const ctaChannel = this.client.guilds.cache
      .find((dggPol) => dggPol.name === DGGP_GUILD_NAME)
      ?.channels.cache.find((ctaChan) => ctaChan?.name === ctaChannelName)
    const d = new Date()

    if (ctaChannel?.type === ChannelType.GuildAnnouncement) {
      const ctaPostTrigger = new CTAPostTrigger()
      await ctaPostTrigger.getChannelThreads(ctaChannel)

      // fetch all CTA Channel messages
      // for each that is less than a month old
      // execute the ctaPostTrigger
      ctaChannel.messages.fetch().then((msgs) => {
        msgs.forEach((msg) => {
          if (new Date(msg.createdTimestamp).getMonth() >= d.getMonth() - 1) {
            ctaPostTrigger.execute(msg)
          }
        })
      })
    }
  }

  private onShardReady(shardId: number, _unavailableGuilds: Set<string>): void {
    Logger.setShardId(shardId)
  }

  private async onGuildJoin(guild: Guild): Promise<void> {
    if (!this.ready || Debug.dummyMode.enabled) {
      return
    }

    try {
      await this.guildJoinHandler.process(guild)
    } catch (error) {
      Logger.error(Logs.error.guildJoin, error)
    }
  }

  private async onGuildLeave(guild: Guild): Promise<void> {
    if (!this.ready || Debug.dummyMode.enabled) {
      return
    }

    try {
      await this.guildLeaveHandler.process(guild)
    } catch (error) {
      Logger.error(Logs.error.guildLeave, error)
    }
  }

  private async onGuildMemberAdd(member: GuildMember): Promise<void> {
    if (
      !this.ready ||
      (Debug.dummyMode.enabled && !Debug.dummyMode.whitelist.includes(member.id))
    ) {
      return
    }

    try {
      await this.guildMemberAddHandler.process(member)
    } catch (error) {
      Logger.error(Logs.error.guildMemberAdd, error)
    }
  }

  private async onGuildMemberUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    if (
      !this.ready ||
      (Debug.dummyMode.enabled && !Debug.dummyMode.whitelist.includes(newMember.id))
    ) {
      return
    }

    try {
      await this.guildMemberUpdateHandler.process(oldMember, newMember)
    } catch (error) {
      Logger.error(Logs.error.guildMemberUpdate, error)
    }
  }

  private async onMessage(msg: Message): Promise<void> {
    if (
      !this.ready ||
      (Debug.dummyMode.enabled && !Debug.dummyMode.whitelist.includes(msg.author.id))
    ) {
      return
    }

    try {
      const filledMsg = await PartialUtils.fillMessage(msg)
      if (!filledMsg) {
        return
      }

      await this.messageHandler.process(filledMsg)
    } catch (error) {
      Logger.error(Logs.error.message, error)
    }
  }

  private async onInteraction(intr: Interaction): Promise<void> {
    if (
      !this.ready ||
      (Debug.dummyMode.enabled && !Debug.dummyMode.whitelist.includes(intr.user.id))
    ) {
      return
    }

    if (intr instanceof CommandInteraction || intr instanceof AutocompleteInteraction) {
      try {
        await this.commandHandler.process(intr)
      } catch (error) {
        Logger.error(Logs.error.command, error)
      }
    } else if (intr instanceof ButtonInteraction) {
      try {
        await this.buttonHandler.process(intr)
      } catch (error) {
        Logger.error(Logs.error.button, error)
      }
    }
  }

  private async onReaction(
    msgReaction: MessageReaction | PartialMessageReaction,
    reactor: User | PartialUser,
  ): Promise<void> {
    if (
      !this.ready ||
      (Debug.dummyMode.enabled && !Debug.dummyMode.whitelist.includes(reactor.id))
    ) {
      return
    }

    try {
      const filledReaction = await PartialUtils.fillReaction(msgReaction)
      if (!filledReaction) {
        return
      }
      msgReaction = filledReaction

      const filledUser = await PartialUtils.fillUser(reactor)
      if (!filledUser) {
        return
      }
      reactor = filledUser

      await this.reactionHandler.process(msgReaction, msgReaction.message as Message, reactor)
    } catch (error) {
      Logger.error(Logs.error.reaction, error)
    }
  }

  private async onGuildScheduledEventCreate(event: GuildScheduledEvent): Promise<void> {
    if (!this.ready || Debug.dummyMode.enabled) return
    try {
      await this.guildScheduledEventHandler.onCreate(event)
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name), error)
    }
  }

  private async onGuildScheduledEventUpdate(
    oldEvent: GuildScheduledEvent | PartialGuildScheduledEvent | null,
    newEvent: GuildScheduledEvent,
  ): Promise<void> {
    if (!this.ready || Debug.dummyMode.enabled) return
    try {
      await this.guildScheduledEventHandler.onUpdate(oldEvent, newEvent)
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', newEvent.name), error)
    }
  }

  private async onGuildScheduledEventDelete(
    event: GuildScheduledEvent | PartialGuildScheduledEvent,
  ): Promise<void> {
    if (!this.ready || Debug.dummyMode.enabled) return
    try {
      await this.guildScheduledEventHandler.onDelete(event)
    } catch (error) {
      Logger.error(Logs.error.calendarSync.replace('{EVENT_NAME}', event.name ?? event.id), error)
    }
  }

  private async onVoiceStateUpdate(
    oldState: import('discord.js').VoiceState,
    newState: import('discord.js').VoiceState,
  ): Promise<void> {
    if (!this.ready || !this.voiceStateUpdateHandler) {
      return
    }
    try {
      await this.voiceStateUpdateHandler.process(oldState, newState)
    } catch (error) {
      Logger.error(Logs.error.voiceStateUpdate, error)
    }
  }

  private async onRateLimit(rateLimitData: RateLimitData): Promise<void> {
    if (rateLimitData.timeToReset >= Config.logging.rateLimit.minTimeout * 1000) {
      Logger.error(Logs.error.apiRateLimit, rateLimitData)
    }
  }
}
