import { type ChatInputCommandInteraction, type PermissionsString, type User } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  getGitHubTeam,
  getGoogleGroupAddress,
  GrantAccessAllowedRoleKeys,
  type ServerRole,
  ServerRoles,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type GitHubTeamsService,
  type GoogleGroupsService,
  Lang,
  Logger,
  type UserService,
} from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

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

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default), true)
    const teamShortname = intr.options.getString(
      Lang.getRef('arguments.team', Language.Default),
      true,
    )
    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)

    if (service === 'google') {
      await this.grantGoogleAccess(intr, data, teamShortname, targetUser)
      return
    }

    if (service === 'github') {
      await this.grantGitHubAccess(intr, data, teamShortname, targetUser)
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
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'Google group',
          REQUIREMENT: 'The service account credentials and database connection must be set.',
        }),
        true,
      )
      return
    }

    let linked
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'google')
    } catch (err: unknown) {
      Logger.error(`/grant-access: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'Google group',
          REQUIREMENT: 'The service account credentials and database connection must be set.',
        }),
        true,
      )
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
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'Google group',
          REQUIREMENT: 'The service account credentials and database connection must be set.',
        }),
        true,
      )
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
  ): Promise<void> {
    const githubTeam = getGitHubTeam(teamShortname)
    if (!githubTeam) {
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

    const githubTeamsService = this.githubTeamsService
    const userService = this.userService
    if (!githubTeamsService?.isConfigured() || !userService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'GitHub team',
          REQUIREMENT: 'A GitHub API token and database connection must be set.',
        }),
        true,
      )
      return
    }

    let linked
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'github')
    } catch (err: unknown) {
      Logger.error(`/grant-access: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'GitHub team',
          REQUIREMENT: 'A GitHub API token and database connection must be set.',
        }),
        true,
      )
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

    const addResult = await githubTeamsService.addMember(githubTeam.org, githubTeam.team, username)
    if (addResult.status === 'not-configured') {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang, {
          RESOURCE_LABEL: 'GitHub team',
          REQUIREMENT: 'A GitHub API token and database connection must be set.',
        }),
        true,
      )
      return
    }

    if (addResult.status === 'active' || addResult.status === 'pending') {
      const ref =
        addResult.status === 'active'
          ? 'displayEmbeds.grantAccessAdded'
          : 'displayEmbeds.grantAccessPending'
      Logger.info(
        `${intr.user.tag} granted ${targetUser.tag} access to team '${teamShortname}' — ${addResult.status}`,
      )
      await InteractionUtils.send(
        intr,
        Lang.getEmbed(ref, data.lang, {
          USER: targetUser.toString(),
          TEAM_LABEL: teamShortname,
          RESOURCE_LABEL: 'GitHub team',
        }),
        false,
      )
      return
    }

    Logger.error(
      `/grant-access: failed to add ${targetUser.tag} to team '${teamShortname}': ${addResult.message}`,
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
