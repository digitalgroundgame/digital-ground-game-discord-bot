import {
  type ChatInputCommandInteraction,
  type Collection,
  DiscordjsErrorCodes,
  escapeMarkdown,
  type GuildMember,
  type PermissionsString,
  type Snowflake,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { DiscordLimits, PingSkillRoleAllowedRoleKeys, ServerRoles } from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * Splits member IDs into per-message mention groups, bounded by both the
 * message content length and Discord's 100-entry allowed-mentions user cap.
 * Exported for tests.
 */
export function chunkMentionIds(memberIds: Iterable<Snowflake>): Snowflake[][] {
  const chunks: Snowflake[][] = []
  let chunk: Snowflake[] = []
  let chunkLength = 0
  for (const memberId of memberIds) {
    const mentionLength = `<@${memberId}> `.length
    if (
      chunk.length >= DiscordLimits.MENTIONS_PER_MESSAGE ||
      chunkLength + mentionLength > DiscordLimits.MESSAGE_CONTENT_LENGTH
    ) {
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
  return chunks
}

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
  public requireRoles = PingSkillRoleAllowedRoleKeys.map((key) => ServerRoles[key].id)

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

    // A full gateway member fetch (opcode 8) is aggressively rate limited.
    // Reuse the cache only when it holds every member AND presences have been
    // hydrated — other code paths fill the member cache without presences,
    // which would otherwise report everyone as offline.
    let members: Collection<Snowflake, GuildMember>
    if (
      intr.guild.members.cache.size >= intr.guild.memberCount &&
      intr.guild.presences.cache.size > 0
    ) {
      members = intr.guild.members.cache
    } else {
      try {
        members = await intr.guild.members.fetch({ withPresences: true })
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (code === DiscordjsErrorCodes.GuildMembersTimeout) {
          await InteractionUtils.editReply(
            intr,
            Lang.getEmbed('displayEmbeds.pingSkillRoleFetchTimedOut', data.lang),
          )
          return
        }
        if (error instanceof Error && error.name === 'GatewayRateLimitError') {
          const retryAfter = (error as { data?: { retry_after?: unknown } }).data?.retry_after
          const seconds = Math.ceil(typeof retryAfter === 'number' ? retryAfter : 30)
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

    // "Online" is any visible presence (online/idle/dnd) — dnd members still
    // get the mention badge, just no popup. Invisible members report as
    // offline and are intentionally skipped, as are bots and the requester.
    const roleId = role.id
    const onlineMembers = members.filter(
      (member) =>
        !member.user.bot &&
        member.id !== intr.user.id &&
        member.roles.cache.has(roleId) &&
        member.presence != null &&
        member.presence.status !== 'offline',
    )

    const skillName = escapeMarkdown(role.name)
    if (onlineMembers.size === 0) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingSkillRoleNoneOnline', data.lang, { SKILL: skillName }),
      )
      return
    }

    const header = note
      ? Lang.getRef('pingSkillRole.headerWithNote', data.lang, {
          SKILL: skillName,
          USER: intr.user.toString(),
          NOTE: note,
        })
      : Lang.getRef('pingSkillRole.header', data.lang, {
          SKILL: skillName,
          USER: intr.user.toString(),
        })

    // The header resolves the deferred placeholder; it mentions the
    // requester, so suppress that ping.
    await InteractionUtils.editReply(intr, { content: header, allowedMentions: { parse: [] } })

    // Mention members individually, chunked to stay within the message limits.
    const chunks = chunkMentionIds(onlineMembers.keys())
    let sentChunks = 0
    try {
      for (const memberIds of chunks) {
        await InteractionUtils.send(intr, {
          content: memberIds.map((memberId) => `<@${memberId}>`).join(' '),
          allowedMentions: { users: memberIds },
        })
        sentChunks++
      }
    } catch (error) {
      Logger.error(
        `/ping-skill-role: delivered ${sentChunks} of ${chunks.length} mention message(s) for role '${role.name}' before failing`,
        error,
      )
      throw error
    }

    Logger.info(
      `${intr.user.tag} pinged ${onlineMembers.size} online member(s) of role '${role.name}' in #${intr.channel && 'name' in intr.channel ? intr.channel.name : intr.channelId}`,
    )
  }
}
