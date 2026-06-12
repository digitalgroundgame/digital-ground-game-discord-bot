import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  type EmbedBuilder,
} from 'discord.js'

import { InteractionUtils } from './interaction-utils.js'

/** The prompt and its two non-confirm outcomes. */
export interface ConfirmEmbeds {
  confirm: EmbedBuilder
  cancelled: EmbedBuilder
  timedOut: EmbedBuilder
}

const DEFAULT_TIMEOUT_MS = 60_000

export class ConfirmUtils {
  /**
   * Send an ephemeral confirm/cancel prompt on a deferred interaction.
   * Cancel and timeout update the prompt themselves and return null;
   * confirmation returns the (unacknowledged) button interaction so the
   * caller can perform the action and update the prompt with its result.
   */
  public static async confirm(
    intr: ChatInputCommandInteraction,
    embeds: ConfirmEmbeds,
    confirmLabel: string,
    timeMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ButtonInteraction | null> {
    const confirmId = `confirm-${intr.id}`
    const cancelId = `cancel-${intr.id}`
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel(confirmLabel).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )

    const prompt = await InteractionUtils.send(
      intr,
      { embeds: [embeds.confirm], components: [buttons] },
      true,
    )
    if (!prompt) return null

    let button: ButtonInteraction
    try {
      button = (await prompt.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.user.id === intr.user.id && (i.customId === confirmId || i.customId === cancelId),
        time: timeMs,
      })) as ButtonInteraction
    } catch {
      await InteractionUtils.editReply(intr, { embeds: [embeds.timedOut], components: [] })
      return null
    }

    if (button.customId === cancelId) {
      await InteractionUtils.update(button, { embeds: [embeds.cancelled], components: [] })
      return null
    }

    return button
  }
}
