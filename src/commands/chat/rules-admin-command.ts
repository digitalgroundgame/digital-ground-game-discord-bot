import {
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { ServerRoles } from '../../constants/index.js'
import { RulesAdminSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang, Logger, type RuleService, type RuleText } from '../../services/index.js'
import { ConfirmUtils, InteractionUtils, ModalUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

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
    if (!(await this.checkTitleNotEmpty(submit, data, text))) return

    try {
      const updated = await this.ruleService.updateRule(position, text, intr.user.id)
      if (!updated) {
        // The rule disappeared between the modal opening and submission.
        await this.sendRuleNotFound(submit, data, position)
        return
      }
    } catch (error) {
      Logger.error(`/rules-admin: failed to update rule ${position}`, error)
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.ruleSaveFailed', data.lang),
        true,
      )
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
    if (!(await this.checkTitleNotEmpty(submit, data, text))) return

    let added
    try {
      added = await this.ruleService.addRule(text, intr.user.id)
    } catch (error) {
      Logger.error('/rules-admin: failed to add rule', error)
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.ruleSaveFailed', data.lang),
        true,
      )
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

    const button = await ConfirmUtils.confirm(
      intr,
      {
        confirm: Lang.getEmbed('displayEmbeds.ruleRemoveConfirm', data.lang, {
          NUMBER: position.toString(),
          TITLE: existing.title,
        }),
        cancelled: Lang.getEmbed('displayEmbeds.ruleRemoveCancelled', data.lang),
        timedOut: Lang.getEmbed('displayEmbeds.ruleRemoveTimedOut', data.lang),
      },
      'Remove',
    )
    if (!button) return

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
    return ModalUtils.collect(intr, modalTitle, [
      {
        id: 'title',
        label: 'Title',
        style: 'short',
        maxLength: TITLE_MAX_LENGTH,
        value: current?.title,
      },
      {
        id: 'description',
        label: 'Description',
        style: 'paragraph',
        maxLength: DESCRIPTION_MAX_LENGTH,
        required: false,
        value: current?.description,
      },
    ])
  }

  private readRuleText(submit: ModalSubmitInteraction): RuleText {
    return {
      title: submit.fields.getTextInputValue('title').trim(),
      description: submit.fields.getTextInputValue('description').trim(),
    }
  }

  /**
   * Discord's required-input check counts whitespace as content, so an
   * all-spaces title would otherwise save as empty and render a blank rule
   * heading. The description is allowed to be empty (rule 1 is title-only).
   */
  private async checkTitleNotEmpty(
    submit: ModalSubmitInteraction,
    data: EventData,
    text: RuleText,
  ): Promise<boolean> {
    if (text.title) return true
    await InteractionUtils.send(submit, Lang.getEmbed('displayEmbeds.ruleTitleEmpty', data.lang), true)
    return false
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
