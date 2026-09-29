import {
  DiscordAPIError,
  RESTJSONErrorCodes as DiscordApiErrors,
  type Locale,
  type User,
  escapeMarkdown,
} from 'discord.js'

import { type KudosNotificationEntry, type KudosService } from './kudos-service.js'
import { Lang } from './lang.js'
import { Logger } from './logger.js'

/**
 * DMs receivers about kudos they were given, combining gives within the
 * notification window into one editable message. Shared by `/kudos give` and
 * the kudos reaction so concurrent gives to one receiver are serialized.
 */
export class KudosNotifier {
  private readonly queues = new Map<string, Promise<boolean>>()

  constructor(private readonly kudosService: KudosService) {}

  /** Returns whether the receiver was actually notified (DM sent/edited). */
  public async notify(
    guildId: string,
    receiver: User,
    givenAt: Date,
    lang: Locale,
  ): Promise<boolean> {
    const key = `${guildId}:${receiver.id}`
    const previous = this.queues.get(key) ?? Promise.resolve(true)
    const current = previous
      .catch(() => false)
      .then(() => this.sendOrEdit(guildId, receiver, givenAt, lang))
    this.queues.set(key, current)

    try {
      return await current
    } finally {
      if (this.queues.get(key) === current) {
        this.queues.delete(key)
      }
    }
  }

  private async sendOrEdit(
    guildId: string,
    receiver: User,
    givenAt: Date,
    lang: Locale,
  ): Promise<boolean> {
    try {
      const batch = await this.kudosService.getNotificationBatch(guildId, receiver.id, givenAt)
      const total = await this.kudosService.getTotal(guildId, receiver.id)
      const givers = batch.entries.map((entry) => this.formatEntry(guildId, entry, lang))
      const embed = Lang.getEmbed('displayEmbeds.kudosReceived', lang, {
        AMOUNT: batch.entries.length.toString(),
        GIVERS: givers.join('\n'),
        TOTAL: total.toString(),
      })

      if (batch.messageId) {
        try {
          const dm = await receiver.createDM()
          const message = await dm.messages.fetch(batch.messageId)
          await message.edit({ embeds: [embed] })
          return true
        } catch (error) {
          if (
            !(error instanceof DiscordAPIError) ||
            error.code !== DiscordApiErrors.UnknownMessage
          ) {
            throw error
          }
        }
      }

      const message = await receiver.send({ embeds: [embed] })
      await this.kudosService.saveNotification(
        guildId,
        receiver.id,
        message.id,
        batch.windowStartedAt,
      )
      return true
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        error.code === DiscordApiErrors.CannotSendMessagesToThisUser
      ) {
        Logger.info(`kudos: ${receiver.tag} has DMs closed, skipping notification`)
        return false
      }

      Logger.error(`kudos: failed to notify ${receiver.tag}`, error)
      return false
    }
  }

  private formatEntry(guildId: string, entry: KudosNotificationEntry, lang: Locale): string {
    const giver = `<@${entry.giverDiscordId}>`

    if (entry.channelId && entry.messageId) {
      return Lang.getRef('kudosNotification.entryWithMessage', lang, {
        GIVER: giver,
        MESSAGE_URL: `https://discord.com/channels/${guildId}/${entry.channelId}/${entry.messageId}`,
      })
    }

    if (entry.reason) {
      return Lang.getRef('kudosNotification.entryWithReason', lang, {
        GIVER: giver,
        REASON: escapeMarkdown(entry.reason, {
          maskedLink: true,
          heading: true,
          bulletedList: true,
          numberedList: true,
        }),
      })
    }

    return Lang.getRef('kudosNotification.entry', lang, { GIVER: giver })
  }
}
