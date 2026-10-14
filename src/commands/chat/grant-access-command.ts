import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  GuildMember,
  type Locale,
  type PermissionsString,
  type User,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  DiscordLimits,
  type GitHubTeam,
  type GitHubTeamRole,
  getGoogleGroupAddress,
  GoogleGroups,
  GrantAccessAllowedRoleKeys,
  resolveGitHubTeamSlug,
  selectableGitHubTeams,
  type ServerRole,
  toGitHubTeamRole,
  ServerRoles,
} from '../../constants/index.js'
import { type LinkedAccount } from '../../database/schema.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type GitHubTeamsService,
  type GoogleGroupsService,
  Lang,
  Logger,
  type UserService,
} from '../../services/index.js'
import { InteractionUtils, RoleUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * Team shortnames selectable for `service`, sorted. Falls back to every known
 * team while `service` is still unset, since Discord sends autocomplete
 * requests before the other options are filled in.
 *
 * GitHub names come from the cached org team list rather than config, so this
 * stays a synchronous in-memory read — Discord gives autocomplete about three
 * seconds, which is no budget for a round trip to GitHub.
 */
function teamShortnames(service: string | null, githubTeams: readonly GitHubTeam[]): string[] {
  const github = (): string[] => selectableGitHubTeams(githubTeams).map((team) => team.name)
  switch (service) {
    case 'google':
      return Object.keys(GoogleGroups).sort()
    case 'github':
      return github()
    default:
      return Array.from(new Set([...Object.keys(GoogleGroups), ...github()])).sort()
  }
}

/** The "isn't configured" reply for `service`, worded from the lang file. */
function notConfiguredEmbed(service: 'google' | 'github', lang: Locale): EmbedBuilder {
  return Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', lang, {
    RESOURCE_LABEL: Lang.getRef(`grantAccessResources.${service}`, lang),
    REQUIREMENT: Lang.getRef(`grantAccessRequirements.${service}`, lang),
  })
}

/**
 * Grants a Discord member access to a team's resources for a given service.
 * Supports `google` (adds the member to the team's Google Group using their
 * linked Google email) and `github` (adds the member to the team's GitHub
 * team using their linked GitHub username).
 */
export class GrantAccessCommand implements Command {
  public names = [Lang.getRef('chatCommands.grantAccess', Language.Default)]
  public cooldown = new RateLimiter(3, 10000)
  public deferType = CommandDeferType.PUBLIC
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = GrantAccessAllowedRoleKeys.map(
    (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
  ).filter((id): id is string => typeof id === 'string')

  constructor(
    private readonly groupsService?: GoogleGroupsService,
    private readonly userService?: UserService,
    private readonly githubTeamsService?: GitHubTeamsService,
  ) {}

  public async autocomplete(
    intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    // Discord routes autocomplete past the command's role checks, so without
    // this any member could list the org's teams by typing in `team`.
    if (!this.memberMayRun(intr)) return []

    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default))
    // Non-blocking: fills an empty cache for the *next* keystroke if the
    // startup refresh has not landed yet, rather than stalling this one.
    this.githubTeamsService?.warmTeams()
    const search = option.value.toLowerCase()
    return teamShortnames(service, this.githubTeamsService?.getTeams() ?? [])
      .filter((shortname) => shortname.toLowerCase().includes(search))
      .slice(0, DiscordLimits.CHOICES_PER_AUTOCOMPLETE)
      .map((shortname) => ({ name: shortname, value: shortname }))
  }

  /** Mirrors the `requireRoles` check `CommandUtils.runChecks` applies to `execute`. */
  private memberMayRun(intr: AutocompleteInteraction): boolean {
    if (this.requireRoles.length === 0) return true
    return (
      intr.member instanceof GuildMember &&
      RoleUtils.memberHasAnyConfiguredRole(intr.member, this.requireRoles)
    )
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default), true)
    const teamShortname = intr.options.getString(
      Lang.getRef('arguments.team', Language.Default),
      true,
    )
    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)

    if (service === 'google') {
      // `role` is a GitHub concept; a Google Group membership has no equivalent.
      await this.grantGoogleAccess(intr, data, teamShortname, targetUser)
      return
    }

    if (service === 'github') {
      // The option is choice-restricted, so this only defaults when it is unset.
      const role = toGitHubTeamRole(
        intr.options.getString(Lang.getRef('arguments.role', Language.Default)),
      )
      await this.grantGitHubAccess(intr, data, teamShortname, targetUser, role)
      return
    }

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.grantAccessUnknownService', data.lang, { SERVICE: service }),
      true,
    )
  }

  private async grantGoogleAccess(
    intr: ChatInputCommandInteraction,
    data: EventData,
    teamShortname: string,
    targetUser: User,
  ): Promise<void> {
    const groupAddress = getGoogleGroupAddress(teamShortname)
    if (!groupAddress) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessUnknownTeam', data.lang, {
          TEAM: teamShortname,
          RESOURCE_LABEL: 'Google Group',
        }),
        true,
      )
      return
    }

    const groupsService = this.groupsService
    const userService = this.userService
    if (!groupsService?.isConfigured() || !userService) {
      await InteractionUtils.send(intr, notConfiguredEmbed('google', data.lang), true)
      return
    }

    let linked: LinkedAccount | undefined
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'google')
    } catch (err: unknown) {
      Logger.error(`/grant-access: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(intr, notConfiguredEmbed('google', data.lang), true)
      return
    }

    if (!linked?.email) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotLinked', data.lang, {
          USER: targetUser.toString(),
          ACCOUNT_LABEL: 'Google',
        }),
        true,
      )
      return
    }

    const addResult = await groupsService.addMember(groupAddress, linked.email)
    if (addResult.status === 'not-configured') {
      await InteractionUtils.send(intr, notConfiguredEmbed('google', data.lang), true)
      return
    }

    if (addResult.status === 'added' || addResult.status === 'already-member') {
      const ref =
        addResult.status === 'added'
          ? 'displayEmbeds.grantAccessAdded'
          : 'displayEmbeds.grantAccessAlreadyMember'
      Logger.info(
        `${intr.user.tag} granted ${targetUser.tag} access to team '${teamShortname}' — ${addResult.status}`,
      )
      await InteractionUtils.send(
        intr,
        Lang.getEmbed(ref, data.lang, {
          USER: targetUser.toString(),
          TEAM_LABEL: teamShortname,
          RESOURCE_LABEL: 'Google Group',
        }),
        false,
      )
      return
    }

    Logger.error(`/grant-access: failed to add ${targetUser.tag} to team '${teamShortname}'`)
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.grantAccessFailed', data.lang, {
        USER: targetUser.toString(),
        TEAM_LABEL: teamShortname,
      }),
      true,
    )
  }

  private async grantGitHubAccess(
    intr: ChatInputCommandInteraction,
    data: EventData,
    teamShortname: string,
    targetUser: User,
    role: GitHubTeamRole,
  ): Promise<void> {
    const githubTeamsService = this.githubTeamsService
    const userService = this.userService

    if (!githubTeamsService?.isConfigured() || !userService) {
      await InteractionUtils.send(intr, notConfiguredEmbed('github', data.lang), true)
      return
    }

    // Resolved against the cached org teams, refreshing once on a miss so a
    // team created since the last refresh can still be granted. Returns null
    // for an excluded team or any descendant of one.
    let teamSlug = resolveGitHubTeamSlug(teamShortname, githubTeamsService.getTeams())
    if (!teamSlug) {
      await githubTeamsService.refreshTeams()
      teamSlug = resolveGitHubTeamSlug(teamShortname, githubTeamsService.getTeams())
    }
    if (!teamSlug) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessUnknownTeam', data.lang, {
          TEAM: teamShortname,
          RESOURCE_LABEL: 'GitHub team',
        }),
        true,
      )
      return
    }

    let linked: LinkedAccount | undefined
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'github')
    } catch (err: unknown) {
      Logger.error(`/grant-access: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(intr, notConfiguredEmbed('github', data.lang), true)
      return
    }

    const username = linked?.externalId
    if (!username) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotLinked', data.lang, {
          USER: targetUser.toString(),
          ACCOUNT_LABEL: 'GitHub',
        }),
        true,
      )
      return
    }

    const addResult = await githubTeamsService.addMember(teamSlug, username, role)
    if (addResult.status === 'not-configured') {
      await InteractionUtils.send(intr, notConfiguredEmbed('github', data.lang), true)
      return
    }

    if (addResult.status === 'active' || addResult.status === 'pending') {
      const ref =
        addResult.status === 'active'
          ? 'displayEmbeds.grantAccessAddedRole'
          : 'displayEmbeds.grantAccessPendingRole'
      Logger.info(
        `${intr.user.tag} granted ${targetUser.tag} access to team '${teamShortname}' as ${role} — ${addResult.status}`,
      )
      await InteractionUtils.send(
        intr,
        Lang.getEmbed(ref, data.lang, {
          USER: targetUser.toString(),
          TEAM_LABEL: teamShortname,
          RESOURCE_LABEL: 'GitHub team',
          // Spelled out rather than left implicit: a maintainer grant hands the
          // target the same team-membership authority the bot's token has.
          ROLE_LABEL: Lang.getRef(`githubTeamRoles.${role}`, Language.Default),
          // Named so a mistyped link is visible before the stranger accepts.
          IDENTIFIER: username,
        }),
        false,
      )
      return
    }

    Logger.error(
      `/grant-access: failed to add ${targetUser.tag} to team '${teamShortname}' as ${role}: ${addResult.message}`,
    )
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.grantAccessFailed', data.lang, {
        USER: targetUser.toString(),
        TEAM_LABEL: teamShortname,
      }),
      true,
    )
  }
}
