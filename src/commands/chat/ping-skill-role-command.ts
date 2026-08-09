import {
  type ChatInputCommandInteraction,
  type Collection,
  type GuildMember,
  type PermissionsString,
  type Snowflake,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  DiscordLimits,
  PingSkillRoleAllowedRoleKeys,
  type ServerRole,
  ServerRoles,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * Notifies the online members of a skill role by mentioning them
 * individually. Discord suppresses role pings for roles with more than 100
 * members inside forum posts; individual user mentions still notify.
 */
export class PingSkillRoleCommand implements Command {
  public names = [Lang.getRef('chatCommands.pingSkillRole', Language.Default)]
  public cooldown = new RateLimiter(2, 60 * 1000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = PingSkillRoleAllowedRoleKeys.map(
    (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
  ).filter((id): id is string => typeof id === 'string')

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    // requireRoles already guarantees a guild context, but narrow the type.
    if (!intr.inGuild() || !intr.guild) {
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    const role = intr.options.getRole(Lang.getRef('arguments.skill', Language.Default), true)
    // Treat a whitespace-only note as no note.
    const note = intr.options.getString(Lang.getRef('arguments.note', Language.Default))?.trim()

    // The role picker includes @everyone; pinging the whole server is never intended.
    // Error paths use editReply: the command handler has already deferred publicly,
    // and an ephemeral follow-up would leave the public placeholder unresolved.
    if (role.id === intr.guild.id) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingSkillRoleEveryone', data.lang),
      )
      return
    }

    // A full gateway member fetch (opcode 8) is aggressively rate limited, so
    // reuse the cache when it already holds every member; presences stay
    // current via presence-update events. Otherwise fetch, and turn a gateway
    // rate limit into a "try again shortly" reply instead of a generic error.
    let members: Collection<Snowflake, GuildMember>
    if (intr.guild.members.cache.size >= intr.guild.memberCount) {
      members = intr.guild.members.cache
    } else {
      try {
        members = await intr.guild.members.fetch({ withPresences: true })
      } catch (error) {
        if (error instanceof Error && error.name === 'GatewayRateLimitError') {
          const retryAfter = (error as { data?: { retry_after?: number } }).data?.retry_after
          const seconds = Math.ceil(retryAfter ?? 30)
          await InteractionUtils.editReply(
            intr,
            Lang.getEmbed('displayEmbeds.pingSkillRoleRateLimited', data.lang, {
              SECONDS: seconds.toString(),
            }),
          )
          return
        }
        throw error
      }
    }
    const onlineMembers = members.filter(
      (member) =>
        !member.user.bot &&
        member.id !== intr.user.id &&
        member.roles.cache.has(role.id) &&
        member.presence != null &&
        member.presence.status !== 'offline',
    )

    if (onlineMembers.size === 0) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingSkillRoleNoneOnline', data.lang, { SKILL: role.name }),
      )
      return
    }

    const header = note
      ? Lang.getRef('pingSkillRole.headerWithNote', data.lang, {
          SKILL: role.name,
          USER: intr.user.toString(),
          NOTE: note,
        })
      : Lang.getRef('pingSkillRole.header', data.lang, {
          SKILL: role.name,
          USER: intr.user.toString(),
        })

    // The header mentions the requester; suppress that ping.
    await InteractionUtils.send(intr, { content: header, allowedMentions: { parse: [] } })

    // Mention members individually, chunked to stay within the message limit.
    let chunk: string[] = []
    let chunkLength = 0
    const chunks: string[][] = []
    for (const memberId of onlineMembers.keys()) {
      const mentionLength = `<@${memberId}> `.length
      if (chunkLength + mentionLength > DiscordLimits.MESSAGE_CONTENT_LENGTH) {
        chunks.push(chunk)
        chunk = []
        chunkLength = 0
      }
      chunk.push(memberId)
      chunkLength += mentionLength
    }
    if (chunk.length > 0) {
      chunks.push(chunk)
    }

    for (const memberIds of chunks) {
      await InteractionUtils.send(intr, {
        content: memberIds.map((memberId) => `<@${memberId}>`).join(' '),
        allowedMentions: { users: memberIds },
      })
    }

    Logger.info(
      `${intr.user.tag} pinged ${onlineMembers.size} online member(s) of role '${role.name}' in #${intr.channel && 'name' in intr.channel ? intr.channel.name : intr.channelId}`,
    )
  }
}
