import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  GuildMember,
  ModalBuilder,
  type PermissionsString,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  GrantAccessAllowedRoleKeys,
  LinkableAccounts,
  ServerRoles,
  type ServerRole,
  getLinkableAccount,
} from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger, type UserService } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** How long the member has to pick a service from the drop-down. */
const SELECT_TIMEOUT_MS = 60_000
/** How long the member has to submit the identifier form. */
const MODAL_TIMEOUT_MS = 5 * 60_000
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
 * else's behalf. The member picks a service from a drop-down, then fills in the
 * required identifier in a pop-up form. If an account is already linked, the
 * issuer must confirm replacing it before the change is saved.
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

    // Step 1 — show the service drop-down.
    const selectId = `link-account-select-${intr.id}`
    const select = new StringSelectMenuBuilder()
      .setCustomId(selectId)
      .setPlaceholder('Choose a service to link')
      .addOptions(
        LinkableAccounts.map((account) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(account.label)
            .setDescription(account.description)
            .setValue(account.provider),
        ),
      )
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)

    const prompt = await InteractionUtils.send(
      intr,
      {
        embeds: [Lang.getEmbed('displayEmbeds.linkAccountPrompt', data.lang, { SUBJECT: subject })],
        components: [row],
      },
      true,
    )
    if (!prompt) return

    // Step 2 — wait for a service to be picked.
    let selection
    try {
      selection = await prompt.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === intr.user.id && i.customId === selectId,
        time: SELECT_TIMEOUT_MS,
      })
    } catch {
      await InteractionUtils.editReply(intr, {
        embeds: [Lang.getEmbed('displayEmbeds.linkAccountTimedOut', data.lang)],
        components: [],
      })
      return
    }

    const account = getLinkableAccount(selection.values[0] ?? '')
    if (!account) {
      await InteractionUtils.editReply(intr, {
        embeds: [Lang.getEmbed('displayEmbeds.linkAccountTimedOut', data.lang)],
        components: [],
      })
      return
    }

    // Step 3 — show the templated identifier form for the chosen service.
    const modalId = `link-account-modal-${intr.id}`
    const inputId = 'identifier'
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(`Link a ${account.label} account`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(inputId)
            .setLabel(account.identifierLabel)
            .setPlaceholder(account.identifierPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(320)
            .setRequired(true),
        ),
      )
    await selection.showModal(modal)

    // Step 4 — wait for the form to be submitted.
    let submit
    try {
      submit = await selection.awaitModalSubmit({
        filter: (i) => i.user.id === intr.user.id && i.customId === modalId,
        time: MODAL_TIMEOUT_MS,
      })
    } catch {
      await InteractionUtils.editReply(intr, {
        embeds: [Lang.getEmbed('displayEmbeds.linkAccountTimedOut', data.lang)],
        components: [],
      })
      return
    }

    // The drop-down has served its purpose — drop it from the original message.
    await InteractionUtils.editReply(intr, { components: [] })

    const rawIdentifier = submit.fields.getTextInputValue(inputId)
    if (!account.validate(rawIdentifier)) {
      await InteractionUtils.send(
        submit,
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

    // Step 5 — if an account is already linked, confirm before replacing it.
    let existing
    try {
      existing = await userService.findLinkedAccount(targetUser.id, account.provider)
    } catch (err: unknown) {
      Logger.error(`/link-account: failed to look up linked account for ${targetUser.tag}`, err)
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.linkAccountFailed', data.lang),
        true,
      )
      return
    }

    const existingIdentifier = existing?.email ?? existing?.externalId
    if (existing) {
      if (existingIdentifier === newIdentifier) {
        await InteractionUtils.send(
          submit,
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
        submit,
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
        await InteractionUtils.editReply(submit, {
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
      return
    }

    // Step 5 (no existing account) — link directly.
    if (!(await this.persistLink(userService, targetUser, account.provider, externalId, email))) {
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.linkAccountFailed', data.lang),
        true,
      )
      return
    }

    Logger.info(`${intr.user.tag} linked ${targetUser.tag}'s ${account.label} account`)
    await InteractionUtils.send(
      submit,
      Lang.getEmbed('displayEmbeds.linkAccountSuccess', data.lang, {
        SUBJECT: subject,
        SERVICE: account.label,
        IDENTIFIER: newIdentifier,
      }),
      true,
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
