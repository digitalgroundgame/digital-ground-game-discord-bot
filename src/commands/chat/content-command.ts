import {
  ActionRowBuilder,
  type ApplicationCommandOptionChoiceData,
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
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

import {
  ManagedContent,
  ManagedContentAllowedRoleKeys,
  type ManagedContentEntry,
  ServerRoles,
  type ServerRole,
} from '../../constants/index.js'
import { ContentSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { type ContentService, Lang, Logger } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** How long the editor has to submit the edit modal. */
const MODAL_TIMEOUT_MS = 10 * 60_000
/** How long the issuer has to confirm a reset. */
const CONFIRM_TIMEOUT_MS = 60_000
/** Discord embed field value cap, for display truncation in `/content show`. */
const EMBED_FIELD_VALUE_MAX = 1024

/** Role IDs allowed to manage content, from `config.managedContent.allowedRoleKeys`. */
const ALLOWED_ROLE_IDS = ManagedContentAllowedRoleKeys.map(
  (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
).filter((id): id is string => typeof id === 'string')

/**
 * Show, edit, or reset managed content (welcome/onboarding/rules text) at
 * runtime. Edits open a modal pre-filled with the current values and apply
 * immediately; reset reverts to the hardcoded registry defaults.
 */
export class ContentCommand implements Command {
  public names = [Lang.getRef('chatCommands.content', Language.Default)]
  public cooldown = new RateLimiter(5, 30_000)
  // NONE: `showModal` must be the interaction's first response; the other
  // subcommands defer themselves.
  public deferType = CommandDeferType.NONE
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = ALLOWED_ROLE_IDS

  constructor(private readonly contentService?: ContentService) {}

  public async autocomplete(
    _intr: AutocompleteInteraction,
    option: AutocompleteFocusedOption,
  ): Promise<ApplicationCommandOptionChoiceData[]> {
    const search = option.value.toLowerCase()
    return Object.entries(ManagedContent)
      .filter(
        ([key, entry]) =>
          key.toLowerCase().includes(search) || entry.label.toLowerCase().includes(search),
      )
      .map(([key, entry]) => ({ name: entry.label, value: key }))
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!this.contentService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.contentNotConfigured', data.lang),
        true,
      )
      return
    }

    const key = intr.options.getString(Lang.getRef('arguments.contentKey', Language.Default), true)
    const entry = ManagedContent[key]
    if (!entry) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.contentUnknownKey', data.lang, { KEY: key }),
        true,
      )
      return
    }

    switch (intr.options.getSubcommand()) {
      case ContentSubcommand.SHOW: {
        await this.show(intr, data, key, entry, this.contentService)
        break
      }
      case ContentSubcommand.EDIT: {
        await this.edit(intr, data, key, entry, this.contentService)
        break
      }
      case ContentSubcommand.RESET: {
        await this.reset(intr, data, key, entry, this.contentService)
        break
      }
    }
  }

  private async show(
    intr: ChatInputCommandInteraction,
    data: EventData,
    key: string,
    entry: ManagedContentEntry,
    contentService: ContentService,
  ): Promise<void> {
    await InteractionUtils.deferReply(intr, true)

    const values = await contentService.getContent(key)
    const meta = await contentService.getOverrideMeta(key)

    const embed = Lang.getEmbed('displayEmbeds.contentShow', data.lang, {
      LABEL: entry.label,
      DESCRIPTION: entry.description,
      OVERRIDE_STATUS: meta
        ? `Overridden by <@${meta.updatedBy}> on <t:${Math.floor(meta.updatedAt.getTime() / 1000)}:f>`
        : 'Using the built-in default (no override).',
    })
    embed.addFields(
      entry.fields.map((field) => ({
        name: field.label,
        value: this.truncate(values[field.id] ?? '', EMBED_FIELD_VALUE_MAX) || '—',
      })),
    )

    await InteractionUtils.send(intr, embed, true)
  }

  private async edit(
    intr: ChatInputCommandInteraction,
    data: EventData,
    key: string,
    entry: ManagedContentEntry,
    contentService: ContentService,
  ): Promise<void> {
    const values = await contentService.getContent(key)

    const modalId = `content-edit-${intr.id}`
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(this.truncate(entry.label, 45))
      .addComponents(
        entry.fields.map((field) =>
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(field.id)
              .setLabel(this.truncate(field.label, 45))
              .setStyle(
                field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short,
              )
              .setMaxLength(field.maxLength)
              .setValue(values[field.id] ?? '')
              .setRequired(field.required ?? true),
          ),
        ),
      )

    await intr.showModal(modal)

    let submit: ModalSubmitInteraction
    try {
      submit = await intr.awaitModalSubmit({
        filter: (i) => i.customId === modalId && i.user.id === intr.user.id,
        time: MODAL_TIMEOUT_MS,
      })
    } catch {
      // Modal abandoned; Discord dismisses it client-side, nothing to clean up.
      return
    }

    await InteractionUtils.deferReply(submit, true)

    const newValues = Object.fromEntries(
      entry.fields.map((field) => [field.id, submit.fields.getTextInputValue(field.id).trim()]),
    )

    try {
      await contentService.setContent(key, newValues, intr.user.id)
    } catch (error) {
      Logger.error(`/content: failed to save override for "${key}"`, error)
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.contentSaveFailed', data.lang),
        true,
      )
      return
    }

    Logger.info(`${intr.user.tag} updated managed content "${key}"`)
    await InteractionUtils.send(
      submit,
      Lang.getEmbed('displayEmbeds.contentUpdated', data.lang, { LABEL: entry.label }),
      true,
    )
  }

  private async reset(
    intr: ChatInputCommandInteraction,
    data: EventData,
    key: string,
    entry: ManagedContentEntry,
    contentService: ContentService,
  ): Promise<void> {
    await InteractionUtils.deferReply(intr, true)

    const meta = await contentService.getOverrideMeta(key)
    if (!meta) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.contentNoOverride', data.lang, { LABEL: entry.label }),
        true,
      )
      return
    }

    const confirmId = `content-reset-confirm-${intr.id}`
    const cancelId = `content-reset-cancel-${intr.id}`
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Reset').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )
    const confirmMsg = await InteractionUtils.send(
      intr,
      {
        embeds: [
          Lang.getEmbed('displayEmbeds.contentResetConfirm', data.lang, { LABEL: entry.label }),
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
        embeds: [Lang.getEmbed('displayEmbeds.contentResetTimedOut', data.lang)],
        components: [],
      })
      return
    }

    if (button.customId === cancelId) {
      await InteractionUtils.update(button, {
        embeds: [
          Lang.getEmbed('displayEmbeds.contentResetCancelled', data.lang, { LABEL: entry.label }),
        ],
        components: [],
      })
      return
    }

    await contentService.resetContent(key)
    Logger.info(`${intr.user.tag} reset managed content "${key}" to defaults`)
    await InteractionUtils.update(button, {
      embeds: [Lang.getEmbed('displayEmbeds.contentReset', data.lang, { LABEL: entry.label })],
      components: [],
    })
  }

  private truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`
  }
}
