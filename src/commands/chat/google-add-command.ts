import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  GoogleAddAllowedRoleKeys,
  getGoogleGroupAddress,
  ServerRoles,
  type ServerRole,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type GoogleGroupsService,
  type GoogleOAuthService,
  Lang,
  Logger,
  type UserService,
} from '../../services/index.js'
import {
  GOOGLE_OAUTH_STATE_TTL_MS,
  InteractionUtils,
  MessageUtils,
  encodeGoogleOAuthState,
} from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

export class GoogleAddCommand implements Command {
  public names = [Lang.getRef('chatCommands.googleAdd', Language.Default)]
  public cooldown = new RateLimiter(3, 10000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = GoogleAddAllowedRoleKeys.map(
    (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
  ).filter((id): id is string => typeof id === 'string')

  constructor(
    private readonly oauthService: GoogleOAuthService,
    private readonly groupsService?: GoogleGroupsService,
    private readonly userService?: UserService,
  ) {}

  /**
   * If the target user has already linked their Google account, add them to the
   * group directly and skip the OAuth sign-in DM. Returns true when the request
   * was fully handled (success or failure), false to fall back to the OAuth flow.
   */
  private async tryAddLinkedUser(
    intr: ChatInputCommandInteraction,
    data: EventData,
    targetUser: ChatInputCommandInteraction['user'],
    groupShortname: string,
    groupAddress: string,
  ): Promise<boolean> {
    const groupsService = this.groupsService
    const userService = this.userService
    if (!groupsService?.isConfigured() || !userService) {
      return false
    }

    let linked
    try {
      linked = await userService.findLinkedAccount(targetUser.id, 'google')
    } catch (err: unknown) {
      Logger.error(`/google-add: failed to look up linked account for ${targetUser.tag}`, err)
      return false
    }
    if (!linked?.email) {
      return false
    }

    const addResult = await groupsService.addMember(groupAddress, linked.email)
    if (addResult.status === 'not-configured') {
      return false
    }

    if (addResult.status === 'added' || addResult.status === 'already-member') {
      const ref =
        addResult.status === 'added'
          ? 'displayEmbeds.googleAddLinkedAdded'
          : 'displayEmbeds.googleAddLinkedAlreadyMember'
      Logger.info(
        `${intr.user.tag} added ${targetUser.tag} (linked) to group '${groupShortname}' — ${addResult.status}`,
      )
      await InteractionUtils.send(
        intr,
        Lang.getEmbed(ref, data.lang, {
          USER: targetUser.toString(),
          GROUP_LABEL: groupShortname,
        }),
        true,
      )
      return true
    }

    Logger.error(
      `/google-add: failed to add linked user ${targetUser.tag} to group '${groupShortname}'`,
    )
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.googleAddLinkedAddFailed', data.lang, {
        USER: targetUser.toString(),
        GROUP_LABEL: groupShortname,
      }),
      true,
    )
    return true
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const groupShortname = intr.options.getString(
      Lang.getRef('arguments.group', Language.Default),
      true,
    )
    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)

    const groupAddress = getGoogleGroupAddress(groupShortname)
    if (!groupAddress) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.googleAddUnknownGroup', data.lang, {
          GROUP: groupShortname,
        }),
        true,
      )
      return
    }

    // Fast path: already-linked users are added without an OAuth round-trip.
    if (await this.tryAddLinkedUser(intr, data, targetUser, groupShortname, groupAddress)) {
      return
    }

    if (!this.oauthService.isConfigured()) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.googleAddNotConfigured', data.lang),
        true,
      )
      return
    }

    const state = encodeGoogleOAuthState({
      discordUserId: targetUser.id,
      groupShortname,
      expiresAt: Date.now() + GOOGLE_OAUTH_STATE_TTL_MS,
    })
    const authUrl = this.oauthService.buildAuthUrl(state)
    if (!authUrl) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.googleAddNotConfigured', data.lang),
        true,
      )
      return
    }

    const inviteEmbed = Lang.getEmbed('displayEmbeds.googleAddInvite', data.lang, {
      GROUP_LABEL: groupShortname,
    })
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Sign in with Google')
        .setURL(authUrl),
    )

    const dm = await MessageUtils.send(targetUser, {
      content: `${targetUser.toString()}`,
      embeds: [inviteEmbed],
      components: [row],
    })

    if (!dm) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.googleAddDmFailed', data.lang, {
          USER: targetUser.toString(),
        }),
        true,
      )
      return
    }

    Logger.info(
      `${intr.user.tag} sent ${targetUser.tag} a Google sign-in link for group '${groupShortname}'`,
    )

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.googleAddDmSent', data.lang, {
        USER: targetUser.toString(),
        GROUP_LABEL: groupShortname,
      }),
      true,
    )
  }
}
