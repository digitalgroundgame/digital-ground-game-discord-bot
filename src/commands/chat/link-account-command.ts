import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  GuildMember,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  GrantAccessAllowedRoleKeys,
  ServerRoles,
  type ServerRole,
  getLinkableAccount,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger, type UserService } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** How long the issuer has to confirm replacing an existing account. */
const CONFIRM_TIMEOUT_MS = 60_000

/** Role IDs allowed to link an account on another member's behalf. */
const COORDINATOR_ROLE_IDS = GrantAccessAllowedRoleKeys.map(
  (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
).filter((id): id is string => typeof id === 'string')

/**
 * Links an external account (e.g. a Google email) to a Discord member.
 *
 * Self-service by default; a coordinator may pass a `user` to link on someone
 * else's behalf. If an account is already linked, the issuer must confirm
 * replacing it before the change is saved.
 */
export class LinkAccountCommand implements Command {
  public names = [Lang.getRef('chatCommands.linkAccount', Language.Default)]
  public cooldown = new RateLimiter(3, 10000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  constructor(private readonly userService?: UserService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const userService = this.userService
    if (!userService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountNotConfigured', data.lang),
        true,
      )
      return
    }

    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default), true)
    const rawIdentifier = intr.options.getString(
      Lang.getRef('arguments.identifier', Language.Default),
      true,
    )
    const targetUser =
      intr.options.getUser(Lang.getRef('arguments.user', Language.Default)) ?? intr.user
    const isSelf = targetUser.id === intr.user.id
    // Possessive used in messages: "your Google account" / "@alice's Google account".
    const subject = isSelf ? 'your' : `${targetUser.toString()}'s`

    // Linking on another member's behalf is a coordinator-only action.
    if (!isSelf) {
      const member = intr.member
      const hasRole =
        member instanceof GuildMember &&
        COORDINATOR_ROLE_IDS.some((id) => member.roles.cache.has(id))
      if (!hasRole) {
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.linkAccountNoPermission', data.lang),
          true,
        )
        return
      }
    }

    const account = getLinkableAccount(service)
    if (!account) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountInvalid', data.lang, {
          SERVICE: service,
          VALUE: rawIdentifier,
        }),
        true,
      )
      return
    }

    if (!account.validate(rawIdentifier)) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountInvalid', data.lang, {
          SERVICE: account.label,
          VALUE: rawIdentifier,
        }),
        true,
      )
      return
    }

    const { externalId, email } = account.normalize(rawIdentifier)
    const newIdentifier = email ?? externalId

    let existing
    try {
      existing = await userService.findLinkedAccount(targetUser.id, account.provider)
    } catch (err: unknown) {
      Logger.error(`/link-account: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountFailed', data.lang),
        true,
      )
      return
    }

    const existingIdentifier = existing?.email ?? existing?.externalId
    if (existing) {
      if (existingIdentifier === newIdentifier) {
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.linkAccountUnchanged', data.lang, {
            SUBJECT: subject,
            SERVICE: account.label,
            IDENTIFIER: newIdentifier,
          }),
          true,
        )
        return
      }

      const confirmId = `link-account-confirm-${intr.id}`
      const cancelId = `link-account-cancel-${intr.id}`
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('Replace').setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(cancelId)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      )
      const confirmMsg = await InteractionUtils.send(
        intr,
        {
          embeds: [
            Lang.getEmbed('displayEmbeds.linkAccountConfirm', data.lang, {
              SUBJECT: subject,
              SERVICE: account.label,
              OLD: existingIdentifier ?? '—',
              NEW: newIdentifier,
            }),
          ],
          components: [buttons],
        },
        true,
      )
      if (!confirmMsg) return

      let button
      try {
        button = await confirmMsg.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) =>
            i.user.id === intr.user.id && (i.customId === confirmId || i.customId === cancelId),
          time: CONFIRM_TIMEOUT_MS,
        })
      } catch {
        await InteractionUtils.editReply(intr, {
          embeds: [Lang.getEmbed('displayEmbeds.linkAccountTimedOut', data.lang)],
          components: [],
        })
        return
      }

      if (button.customId === cancelId) {
        await InteractionUtils.update(button, {
          embeds: [
            Lang.getEmbed('displayEmbeds.linkAccountCancelled', data.lang, {
              SUBJECT: subject,
              SERVICE: account.label,
            }),
          ],
          components: [],
        })
        return
      }

      if (!(await this.persistLink(userService, targetUser, account.provider, externalId, email))) {
        await InteractionUtils.update(button, {
          embeds: [Lang.getEmbed('displayEmbeds.linkAccountFailed', data.lang)],
          components: [],
        })
        return
      }

      Logger.info(`${intr.user.tag} replaced ${targetUser.tag}'s ${account.label} account`)
      await InteractionUtils.update(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.linkAccountSuccess', data.lang, {
            SUBJECT: subject,
            SERVICE: account.label,
            IDENTIFIER: newIdentifier,
          }),
        ],
        components: [],
      })
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountAnnounce', data.lang, {
          USER: targetUser.toString(),
          SERVICE: account.label,
        }),
        false,
      )
      return
    }

    if (!(await this.persistLink(userService, targetUser, account.provider, externalId, email))) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.linkAccountFailed', data.lang),
        true,
      )
      return
    }

    Logger.info(`${intr.user.tag} linked ${targetUser.tag}'s ${account.label} account`)
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.linkAccountSuccess', data.lang, {
        SUBJECT: subject,
        SERVICE: account.label,
        IDENTIFIER: newIdentifier,
      }),
      true,
    )
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.linkAccountAnnounce', data.lang, {
        USER: targetUser.toString(),
        SERVICE: account.label,
      }),
      false,
    )
  }

  /** Upsert the linked account, logging and swallowing any failure. */
  private async persistLink(
    userService: UserService,
    targetUser: ChatInputCommandInteraction['user'],
    provider: Parameters<UserService['linkAccount']>[1],
    externalId: string,
    email: string | undefined,
  ): Promise<boolean> {
    try {
      await userService.linkAccount(targetUser.id, provider, { externalId, email })
      return true
    } catch (err: unknown) {
      Logger.error(`/link-account: failed to link ${provider} for ${targetUser.tag}`, err)
      return false
    }
  }
}
