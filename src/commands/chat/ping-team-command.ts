import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  escapeMarkdown,
  GuildMember,
  type PermissionsString,
  type Snowflake,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  DiscordLimits,
  findGitHubTeam,
  PingTeamAllowedRoleKeys,
  ServerRoles,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { type GitHubTeamsService, Lang, Logger, type UserService } from '../../services/index.js'
import { InteractionUtils, RoleUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'
import { chunkMentionIds } from './ping-skill-role-command.js'

/**
 * Pings the Discord members of a GitHub team, matched through the GitHub
 * accounts they linked with `/link-account`.
 */
export class PingTeamCommand implements Command {
  public names = [Lang.getRef('chatCommands.pingTeam', Language.Default)]
  public cooldown = new RateLimiter(2, 60 * 1000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = PingTeamAllowedRoleKeys.map((key) => ServerRoles[key].id)

  constructor(
    private readonly githubTeamsService?: GitHubTeamsService,
    private readonly userService?: UserService,
  ) {}

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    // Discord routes autocomplete past the command's role checks.
    if (!this.memberMayRun(intr)) return []

    this.githubTeamsService?.warmTeams()
    const search = option.value.toLowerCase()
    return (this.githubTeamsService?.getTeams() ?? [])
      .map((team) => team.name)
      .filter((name) => name.toLowerCase().includes(search))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, DiscordLimits.CHOICES_PER_AUTOCOMPLETE)
      .map((name) => ({ name, value: name }))
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!intr.inGuild() || !intr.guild) {
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    const teamInput = intr.options.getString(Lang.getRef('arguments.team', Language.Default), true)
    const githubTeamsService = this.githubTeamsService
    const userService = this.userService
    if (!githubTeamsService?.isConfigured() || !userService) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamNotConfigured', data.lang),
      )
      return
    }

    // Resolved against the cached org teams, refreshing once on a miss so a
    // team created since the last refresh can still be pinged.
    let team = findGitHubTeam(teamInput, githubTeamsService.getTeams())
    if (!team) {
      await githubTeamsService.refreshTeams()
      team = findGitHubTeam(teamInput, githubTeamsService.getTeams())
    }
    if (!team) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamUnknownTeam', data.lang, { TEAM: teamInput }),
      )
      return
    }
    const teamName = escapeMarkdown(team.name)

    const members = await githubTeamsService.listTeamMembers(team.slug)
    if (members.status === 'not-configured') {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamNotConfigured', data.lang),
      )
      return
    }
    if (members.status === 'error') {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamFailed', data.lang, { TEAM: teamName }),
      )
      return
    }

    let memberIds: Snowflake[]
    try {
      memberIds = await userService.findDiscordUserIdsByGithubLogins(
        members.logins.map((login) => login.toLowerCase()),
      )
    } catch (err: unknown) {
      Logger.error(`/ping-team: failed to look up linked accounts for ${team.slug}`, err)
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamFailed', data.lang, { TEAM: teamName }),
      )
      return
    }

    const pingedIds = memberIds.filter((memberId) => memberId !== intr.user.id)
    if (pingedIds.length === 0) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.pingTeamNoneLinked', data.lang, { TEAM: teamName }),
      )
      return
    }

    const header = Lang.getRef('pingTeam.header', data.lang, {
      TEAM: teamName,
      USER: intr.user.toString(),
    })
    await InteractionUtils.editReply(intr, { content: header, allowedMentions: { parse: [] } })

    const chunks = chunkMentionIds(pingedIds)
    let sentChunks = 0
    try {
      for (const chunk of chunks) {
        await InteractionUtils.send(intr, {
          content: chunk.map((memberId) => `<@${memberId}>`).join(' '),
          allowedMentions: { users: chunk },
        })
        sentChunks++
      }
    } catch (error) {
      Logger.error(
        `/ping-team: delivered ${sentChunks} of ${chunks.length} mention message(s) for team '${team.slug}' before failing`,
        error,
      )
      throw error
    }

    Logger.info(
      `${intr.user.tag} pinged ${pingedIds.length} linked member(s) of GitHub team '${team.slug}'`,
    )
  }

  /** Mirrors the `requireRoles` check `CommandUtils.runChecks` applies to `execute`. */
  private memberMayRun(intr: AutocompleteInteraction): boolean {
    return (
      intr.member instanceof GuildMember &&
      RoleUtils.memberHasAnyConfiguredRole(intr.member, this.requireRoles)
    )
  }
}
