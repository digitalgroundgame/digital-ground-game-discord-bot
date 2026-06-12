import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  ModalBuilder,
  type ModalSubmitInteraction,
  type PermissionsString,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { ServerRoles } from '../../constants/index.js'
import { RulesAdminSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger, type RuleService, type RuleText } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** How long the editor has to submit the rule modal. */
const MODAL_TIMEOUT_MS = 10 * 60_000
/** How long the issuer has to confirm a removal. */
const CONFIRM_TIMEOUT_MS = 60_000
/** Rendered inside an embed field name (256 cap, minus the number prefix). */
const TITLE_MAX_LENGTH = 200
/** Rendered as an embed field value (1024 cap). */
const DESCRIPTION_MAX_LENGTH = 1024

/**
 * Admin management of the server rules shown by /rules: edit a rule's text,
 * append a new rule, or remove one (renumbering the rest). Edits open a
 * modal and apply immediately.
 */
export class RulesAdminCommand implements Command {
  public names = [Lang.getRef('chatCommands.rulesAdmin', Language.Default)]
  public cooldown = new RateLimiter(5, 30_000)
  // NONE: `showModal` must be the interaction's first response; the remove
  // subcommand defers itself.
  public deferType = CommandDeferType.NONE
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = [ServerRoles.ADMIN.id]

  constructor(private readonly ruleService: RuleService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!this.ruleService.isPersistent) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.rulesAdminNotConfigured', data.lang),
        true,
      )
      return
    }

    switch (intr.options.getSubcommand()) {
      case RulesAdminSubcommand.EDIT: {
        await this.edit(intr, data)
        break
      }
      case RulesAdminSubcommand.ADD: {
        await this.add(intr, data)
        break
      }
      case RulesAdminSubcommand.REMOVE: {
        await this.remove(intr, data)
        break
      }
    }
  }

  private async edit(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const position = this.getRuleNumber(intr)
    const existing = await this.ruleService.getRule(position)
    if (!existing) {
      await this.sendRuleNotFound(intr, data, position)
      return
    }

    const submit = await this.collectRuleModal(intr, `Edit Rule ${position}`, existing)
    if (!submit) return
    const text = this.readRuleText(submit)

    try {
      const updated = await this.ruleService.updateRule(position, text, intr.user.id)
      if (!updated) {
        // The rule disappeared between the modal opening and submission.
        await this.sendRuleNotFound(submit, data, position)
        return
      }
    } catch (error) {
      Logger.error(`/rules-admin: failed to update rule ${position}`, error)
      await InteractionUtils.send(submit, Lang.getEmbed('displayEmbeds.ruleSaveFailed', data.lang), true)
      return
    }

    await InteractionUtils.send(
      submit,
      Lang.getEmbed('displayEmbeds.ruleUpdated', data.lang, {
        NUMBER: position.toString(),
        TITLE: text.title,
      }),
      true,
    )
  }

  private async add(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const submit = await this.collectRuleModal(intr, 'Add Rule')
    if (!submit) return
    const text = this.readRuleText(submit)

    let added
    try {
      added = await this.ruleService.addRule(text, intr.user.id)
    } catch (error) {
      Logger.error('/rules-admin: failed to add rule', error)
      await InteractionUtils.send(submit, Lang.getEmbed('displayEmbeds.ruleSaveFailed', data.lang), true)
      return
    }

    await InteractionUtils.send(
      submit,
      Lang.getEmbed('displayEmbeds.ruleAdded', data.lang, {
        NUMBER: added.position.toString(),
        TITLE: added.title,
      }),
      true,
    )
  }

  private async remove(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    await InteractionUtils.deferReply(intr, true)

    const position = this.getRuleNumber(intr)
    const existing = await this.ruleService.getRule(position)
    if (!existing) {
      await this.sendRuleNotFound(intr, data, position)
      return
    }

    const confirmId = `rule-remove-confirm-${intr.id}`
    const cancelId = `rule-remove-cancel-${intr.id}`
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Remove').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )
    const confirmMsg = await InteractionUtils.send(
      intr,
      {
        embeds: [
          Lang.getEmbed('displayEmbeds.ruleRemoveConfirm', data.lang, {
            NUMBER: position.toString(),
            TITLE: existing.title,
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
        embeds: [Lang.getEmbed('displayEmbeds.ruleRemoveTimedOut', data.lang)],
        components: [],
      })
      return
    }

    if (button.customId === cancelId) {
      await InteractionUtils.update(button, {
        embeds: [Lang.getEmbed('displayEmbeds.ruleRemoveCancelled', data.lang)],
        components: [],
      })
      return
    }

    const removed = await this.ruleService.removeRule(position, intr.user.id)
    await InteractionUtils.update(button, {
      embeds: [
        removed
          ? Lang.getEmbed('displayEmbeds.ruleRemoved', data.lang, {
              NUMBER: position.toString(),
              TITLE: existing.title,
            })
          : Lang.getEmbed('displayEmbeds.ruleSaveFailed', data.lang),
      ],
      components: [],
    })
  }

  /**
   * Show the title/description modal and wait for submission. Returns the
   * submit interaction, or null if the modal was abandoned.
   */
  private async collectRuleModal(
    intr: ChatInputCommandInteraction,
    modalTitle: string,
    current?: RuleText,
  ): Promise<ModalSubmitInteraction | null> {
    const modalId = `rule-modal-${intr.id}`
    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Title')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(TITLE_MAX_LENGTH)
      .setRequired(true)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(DESCRIPTION_MAX_LENGTH)
      .setRequired(false)
    if (current) {
      titleInput.setValue(current.title)
      if (current.description) descriptionInput.setValue(current.description)
    }

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(modalTitle)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      )
    await intr.showModal(modal)

    try {
      return await intr.awaitModalSubmit({
        filter: (i) => i.customId === modalId && i.user.id === intr.user.id,
        time: MODAL_TIMEOUT_MS,
      })
    } catch {
      // Modal abandoned; Discord dismisses it client-side, nothing to clean up.
      return null
    }
  }

  private readRuleText(submit: ModalSubmitInteraction): RuleText {
    return {
      title: submit.fields.getTextInputValue('title').trim(),
      description: submit.fields.getTextInputValue('description').trim(),
    }
  }

  private getRuleNumber(intr: ChatInputCommandInteraction): number {
    return intr.options.getInteger(Lang.getRef('arguments.ruleNumber', Language.Default), true)
  }

  private async sendRuleNotFound(
    intr: ChatInputCommandInteraction | ModalSubmitInteraction,
    data: EventData,
    position: number,
  ): Promise<void> {
    const rules = await this.ruleService.getRules()
    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.ruleNotFound', data.lang, {
        NUMBER: position.toString(),
        COUNT: rules.length.toString(),
      }),
      true,
    )
  }
}
