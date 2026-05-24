import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  getGoogleGroupAddress,
  GrantAccessAllowedRoleKeys,
  type ServerRole,
  ServerRoles,
} from '../../constants/index.js'
import { LinkedAccount } from '../../database/schema.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { type GoogleGroupsService, Lang, Logger, type UserService } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * Grants a Discord member access to a team's resources for a given service.
 * Currently supports `google`, which adds the member to the team's Google
 * Group using the Google account they linked via `/link-account`.
 */
export class GrantAccessCommand implements Command {
  public names = [Lang.getRef('chatCommands.grantAccess', Language.Default)]
  public cooldown = new RateLimiter(3, 10000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = GrantAccessAllowedRoleKeys.map(
    (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
  ).filter((id): id is string => typeof id === 'string')

  constructor(
    private readonly groupsService?: GoogleGroupsService,
    private readonly userService?: UserService,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default), true)
    const teamShortname = intr.options.getString(
      Lang.getRef('arguments.team', Language.Default),
      true,
    )
    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)

    // Only Google is supported today; the option choices already enforce this.
    if (service !== 'google') {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessUnknownService', data.lang, { SERVICE: service }),
        true,
      )
      return
    }

    const groupAddress = getGoogleGroupAddress(teamShortname)
    if (!groupAddress) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessUnknownTeam', data.lang, { TEAM: teamShortname }),
        true,
      )
      return
    }

    const groupsService = this.groupsService
    const userService = this.userService
    if (!groupsService?.isConfigured() || !userService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang),
        true,
      )
      return
    }

    let linked: LinkedAccount | undefined
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'google')
    } catch (err: unknown) {
      Logger.error(`/grant-access: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang),
        true,
      )
      return
    }

    if (!linked?.email) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotLinked', data.lang, {
          USER: targetUser.toString(),
        }),
        true,
      )
      return
    }

    const addResult = await groupsService.addMember(groupAddress, linked.email)
    if (addResult.status === 'not-configured') {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.grantAccessNotConfigured', data.lang),
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
}
