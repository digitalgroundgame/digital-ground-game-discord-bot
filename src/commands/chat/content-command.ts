import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteFocusedOption,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import {
  ManagedContent,
  ManagedContentAllowedRoleKeys,
  type ManagedContentEntry,
  ServerRoles,
} from '../../constants/index.js'
import { ContentSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { type ContentService, Lang, Logger } from '../../services/index.js'
import { InteractionUtils, ModalUtils, StringUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/** Discord embed field value cap, for display truncation in `/content show`. */
const EMBED_FIELD_VALUE_MAX = 1024

/** Role IDs allowed to manage content; keys are validated at startup. */
const ALLOWED_ROLE_IDS = ManagedContentAllowedRoleKeys.map((key) => ServerRoles[key].id)

/**
 * Show or edit managed content (welcome/onboarding/rules text) at runtime.
 * Edits open a modal pre-filled with the current values and apply immediately.
 */
export class ContentCommand implements Command {
  public names = [Lang.getRef('chatCommands.content', Language.Default)]
  public cooldown = new RateLimiter(5, 30_000)
  // NONE: `showModal` must be the interaction's first response; the other
  // subcommands defer themselves.
  public deferType = CommandDeferType.NONE
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = ALLOWED_ROLE_IDS

  constructor(private readonly contentService: ContentService) {}

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

    const subcommand = intr.options.getSubcommand()
    if (subcommand !== ContentSubcommand.SHOW && !this.contentService.isPersistent) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.contentNotConfigured', data.lang),
        true,
      )
      return
    }

    switch (subcommand) {
      case ContentSubcommand.SHOW: {
        await this.show(intr, data, key, entry)
        break
      }
      case ContentSubcommand.EDIT: {
        await this.edit(intr, data, key, entry)
        break
      }
    }
  }

  private async show(
    intr: ChatInputCommandInteraction,
    data: EventData,
    key: string,
    entry: ManagedContentEntry,
  ): Promise<void> {
    await InteractionUtils.deferReply(intr, true)

    const { values, meta } = await this.contentService.getOverride(key)

    const overrideStatus = meta
      ? Lang.getRef('contentStatus.overridden', data.lang)
          .replaceAll('{{USER}}', `<@${meta.updatedBy}>`)
          .replaceAll('{{TIME}}', `<t:${Math.floor(meta.updatedAt.getTime() / 1000)}:f>`)
      : Lang.getRef('contentStatus.default', data.lang)

    const embed = Lang.getEmbed('displayEmbeds.contentShow', data.lang, {
      LABEL: entry.label,
      DESCRIPTION: entry.description,
      OVERRIDE_STATUS: overrideStatus,
    })
    embed.addFields(
      entry.fields.map((field) => ({
        name: field.label,
        value: StringUtils.truncate(values[field.id] ?? '', EMBED_FIELD_VALUE_MAX, true) || '—',
      })),
    )

    await InteractionUtils.send(intr, embed, true)
  }

  private async edit(
    intr: ChatInputCommandInteraction,
    data: EventData,
    key: string,
    entry: ManagedContentEntry,
  ): Promise<void> {
    const values = await this.contentService.getContent(key)

    const submit = await ModalUtils.collect(
      intr,
      entry.label,
      entry.fields.map((field) => ({ ...field, value: values[field.id] })),
    )
    if (!submit) return

    await InteractionUtils.deferReply(submit, true)

    const newValues = Object.fromEntries(
      entry.fields.map((field) => [field.id, submit.fields.getTextInputValue(field.id).trim()]),
    )

    // Discord's required-input check counts whitespace as content, so an
    // all-spaces submission would otherwise save an empty override and
    // silently break the consumer (e.g. thread.send rejects empty messages).
    const emptyFields = entry.fields.filter((field) => !newValues[field.id])
    if (emptyFields.length > 0) {
      await InteractionUtils.send(
        submit,
        Lang.getEmbed('displayEmbeds.contentEmptyField', data.lang, {
          FIELDS: emptyFields.map((field) => field.label).join(', '),
        }),
        true,
      )
      return
    }

    try {
      await this.contentService.setContent(key, newValues, intr.user.id)
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
}
