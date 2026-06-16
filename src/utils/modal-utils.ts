import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

import { StringUtils } from './string-utils.js'

/** One text input in a modal. `id` is also used to read the value back. */
export interface ModalTextField {
  id: string
  label: string
  style: 'short' | 'paragraph'
  maxLength: number
  /** Whether the input may be submitted empty (defaults to required). */
  required?: boolean
  /** Pre-filled value, if any. */
  value?: string
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000
/** Discord caps modal titles and text input labels at 45 chars. */
const MODAL_TITLE_MAX = 45

export class ModalUtils {
  /**
   * Show a text-input modal as the interaction's first response and wait
   * for submission. Returns the submit interaction (not yet acknowledged),
   * or null if the modal was abandoned — Discord dismisses it client-side,
   * so there is nothing to clean up.
   */
  public static async collect(
    intr: ChatInputCommandInteraction,
    title: string,
    fields: ModalTextField[],
    timeMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ModalSubmitInteraction | null> {
    const modalId = `modal-${intr.id}`
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(StringUtils.truncate(title, MODAL_TITLE_MAX, true))
      .addComponents(
        fields.map((field) => {
          const input = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(StringUtils.truncate(field.label, MODAL_TITLE_MAX, true))
            .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setMaxLength(field.maxLength)
            .setRequired(field.required ?? true)
          if (field.value) {
            input.setValue(field.value)
          }
          return new ActionRowBuilder<TextInputBuilder>().addComponents(input)
        }),
      )

    await intr.showModal(modal)

    try {
      return await intr.awaitModalSubmit({
        filter: (i) => i.customId === modalId && i.user.id === intr.user.id,
        time: timeMs,
      })
    } catch {
      return null
    }
  }
}
