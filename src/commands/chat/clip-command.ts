import {
  type ChatInputCommandInteraction,
  ChannelType,
  EmbedBuilder,
  type GuildChannel,
  type HexColorString,
  PermissionFlagsBits,
  type PermissionsString,
  type ThreadChannel,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  ClipSuggestionsAllowedRoleKeys,
  ClipSuggestionsChannelId,
  ServerRoles,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger } from '../../services/index.js'
import {
  ClientUtils,
  ClipUtils,
  InteractionUtils,
  type ParsedClipUrl,
  StringUtils,
} from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** Discord caps thread (forum post) names at 100 characters. */
const POST_TITLE_MAX = 100

/** Role IDs allowed to submit; empty lets every member submit. */
const ALLOWED_ROLE_IDS = ClipSuggestionsAllowedRoleKeys.map((key) => ServerRoles[key].id)

const TITLE_REFS: Record<ParsedClipUrl['platform'], string> = {
  youtube: 'clipSuggestion.titleYoutube',
  twitch: 'clipSuggestion.titleTwitch',
  other: 'clipSuggestion.titleOther',
}

/** Overrides for config-driven settings, for tests. */
export interface ClipCommandOptions {
  /** Destination for suggestions; pass `undefined` explicitly for "not set up". */
  channelId?: string
  allowedRoleIds?: string[]
}

interface ClipSuggestion {
  parsed: ParsedClipUrl
  start: number
  end?: number
  note?: string
}

/**
 * Lets members suggest a moment from an online video for the media team to
 * clip. Suggestions go to one configured destination: a forum (one post per
 * suggestion), or a text/announcement channel or thread (one message each).
 */
export class ClipCommand implements Command {
  public names = [Lang.getRef('chatCommands.clip', Language.Default)]
  // Open to every member by default, so cap how fast one member can post
  // into the media team's channel.
  public cooldown = new RateLimiter(3, 60_000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles: string[]

  private readonly channelId: string | undefined

  constructor(options: ClipCommandOptions = {}) {
    this.channelId = 'channelId' in options ? options.channelId : ClipSuggestionsChannelId
    this.requireRoles = options.allowedRoleIds ?? ALLOWED_ROLE_IDS
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!intr.guild) {
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    if (!this.channelId) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.clipNotConfigured', data.lang),
      )
      return
    }

    const suggestion = await this.readSuggestion(intr, data)
    if (!suggestion) return

    const embed = this.buildEmbed(intr, data, suggestion)
    const payload = { embeds: [embed], allowedMentions: { parse: [] } }

    let link: string
    try {
      const channel = await ClientUtils.getChannel(intr.client, this.channelId)
      if (!channel || channel.isDMBased() || channel.guildId !== intr.guild.id) {
        await this.deliveryFailed(intr, data, 'destination was not found in this server')
        return
      }

      if (channel.type === ChannelType.GuildForum) {
        if (!this.canPost(channel, PermissionFlagsBits.SendMessages)) {
          await this.deliveryFailed(intr, data, `missing permissions in forum #${channel.name}`)
          return
        }
        const post = await channel.threads.create({
          name: this.postTitle(data, suggestion),
          message: payload,
        })
        link = post.url
      } else if (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
      ) {
        if (!this.canPost(channel, PermissionFlagsBits.SendMessages)) {
          await this.deliveryFailed(intr, data, `missing permissions in #${channel.name}`)
          return
        }
        link = (await channel.send(payload)).url
      } else if (channel.isThread()) {
        // Sending to an archived (but unlocked) thread unarchives it, so only
        // a lock stops delivery.
        if (channel.locked) {
          await this.deliveryFailed(intr, data, `thread #${channel.name} is locked`)
          return
        }
        if (!this.canPost(channel, PermissionFlagsBits.SendMessagesInThreads)) {
          await this.deliveryFailed(intr, data, `missing permissions in thread #${channel.name}`)
          return
        }
        link = (await channel.send(payload)).url
      } else {
        await this.deliveryFailed(intr, data, `unsupported channel type ${channel.type}`)
        return
      }
    } catch (error) {
      await this.deliveryFailed(intr, data, 'Discord rejected the post', error)
      return
    }

    Logger.info(`${intr.user.tag} submitted a clip suggestion: ${link}`)
    await InteractionUtils.editReply(
      intr,
      Lang.getEmbed('displayEmbeds.clipSubmitted', data.lang, { LINK: link }),
    )
  }

  /**
   * Validates the options in order (url, start, end) and replies with the
   * first problem found. Returns null when the submission was rejected.
   */
  private async readSuggestion(
    intr: ChatInputCommandInteraction,
    data: EventData,
  ): Promise<ClipSuggestion | null> {
    const urlInput = intr.options.getString(Lang.getRef('arguments.url', Language.Default), true)
    const startInput = intr.options.getString(Lang.getRef('arguments.start', Language.Default))
    const endInput = intr.options.getString(Lang.getRef('arguments.end', Language.Default))
    // Treat a whitespace-only note as no note.
    const note =
      intr.options.getString(Lang.getRef('arguments.note', Language.Default))?.trim() || undefined

    const parsed = ClipUtils.parseClipUrl(urlInput)
    if (!parsed) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.clipInvalidUrl', data.lang),
      )
      return null
    }

    // An explicit start wins over a timestamp carried by the link.
    let start = parsed.linkSeconds
    if (startInput?.trim()) {
      const value = ClipUtils.parseTimestamp(startInput)
      if (value === null) {
        await this.invalidTime(intr, data, 'arguments.start')
        return null
      }
      start = value
    }
    if (start === undefined) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.clipMissingStart', data.lang),
      )
      return null
    }

    let end: number | undefined
    if (endInput?.trim()) {
      const value = ClipUtils.parseTimestamp(endInput)
      if (value === null) {
        await this.invalidTime(intr, data, 'arguments.end')
        return null
      }
      if (value <= start) {
        await InteractionUtils.editReply(
          intr,
          Lang.getEmbed('displayEmbeds.clipEndBeforeStart', data.lang, {
            START: ClipUtils.formatTimestamp(start),
            END: ClipUtils.formatTimestamp(value),
          }),
        )
        return null
      }
      end = value
    }

    return { parsed, start, end, note }
  }

  private buildEmbed(
    intr: ChatInputCommandInteraction,
    data: EventData,
    { parsed, start, end, note }: ClipSuggestion,
  ): EmbedBuilder {
    const link = ClipUtils.buildDeepLink(parsed, start)
    const field = (ref: string): string => Lang.getRef(`clipSuggestion.${ref}`, data.langGuild)

    const embed = new EmbedBuilder()
      .setColor(Lang.getCom('colors.default') as HexColorString)
      .setTitle(Lang.getRef(TITLE_REFS[parsed.platform], data.langGuild))
      .setURL(link)
      .addFields({ name: field('start'), value: ClipUtils.formatTimestamp(start), inline: true })
    if (end !== undefined) {
      embed.addFields(
        { name: field('end'), value: ClipUtils.formatTimestamp(end), inline: true },
        { name: field('length'), value: ClipUtils.formatTimestamp(end - start), inline: true },
      )
    }
    embed.addFields(
      { name: field('link'), value: link },
      { name: field('submittedBy'), value: `<@${intr.user.id}>` },
    )
    if (note) {
      embed.setDescription(note)
    }
    return embed
  }

  /** `<note> @ <range>`, with the note shortened to fit, or `Clip @ <range>`. */
  private postTitle(data: EventData, { start, end, note }: ClipSuggestion): string {
    const range =
      end === undefined
        ? ClipUtils.formatTimestamp(start)
        : Lang.getRef('clipSuggestion.range', data.langGuild, {
            START: ClipUtils.formatTimestamp(start),
            END: ClipUtils.formatTimestamp(end),
          })
    if (!note) {
      return Lang.getRef('clipSuggestion.postTitleNoNote', data.langGuild, { RANGE: range })
    }
    const frameLength = Lang.getRef('clipSuggestion.postTitle', data.langGuild, {
      NOTE: '',
      RANGE: range,
    }).length
    const title = Lang.getRef('clipSuggestion.postTitle', data.langGuild, {
      NOTE: StringUtils.truncate(note, POST_TITLE_MAX - frameLength, true),
      RANGE: range,
    })
    return StringUtils.truncate(title, POST_TITLE_MAX, true)
  }

  /** The bot can see the destination, embed links, and send with `sendPermission`. */
  private canPost(channel: GuildChannel | ThreadChannel, sendPermission: bigint): boolean {
    return (
      channel
        .permissionsFor(channel.client.user)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.EmbedLinks, sendPermission]) ??
      false
    )
  }

  private async invalidTime(
    intr: ChatInputCommandInteraction,
    data: EventData,
    fieldRef: string,
  ): Promise<void> {
    await InteractionUtils.editReply(
      intr,
      Lang.getEmbed('displayEmbeds.clipInvalidTime', data.lang, {
        FIELD: Lang.getRef(fieldRef, data.lang),
      }),
    )
  }

  private async deliveryFailed(
    intr: ChatInputCommandInteraction,
    data: EventData,
    reason: string,
    error?: unknown,
  ): Promise<void> {
    await Logger.error(
      `/clip: could not deliver a suggestion to channel ${this.channelId}: ${reason}`,
      error,
    )
    await InteractionUtils.editReply(
      intr,
      Lang.getEmbed('displayEmbeds.clipDeliveryFailed', data.lang),
    )
  }
}
