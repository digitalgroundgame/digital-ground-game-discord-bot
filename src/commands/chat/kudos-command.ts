import {
  DiscordAPIError,
  GuildMember,
  RESTJSONErrorCodes as DiscordApiErrors,
  type ChatInputCommandInteraction,
  type PermissionsString,
} from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { KudosGiveAllowedRoleKeys, ServerRoles, getRoleNameById } from '../../constants/index.js'
import { KudosSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type KudosLeaderboardPeriod,
  type KudosService,
  Lang,
  Logger,
} from '../../services/index.js'
import { InteractionUtils, RoleUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

const GIVE_ALLOWED_ROLE_IDS = KudosGiveAllowedRoleKeys.map((key) => ServerRoles[key].id)

const MEDALS = ['🥇', '🥈', '🥉']

/**
 * Lets members give each other kudos for good work, view kudos totals, and
 * check the weekly/monthly leaderboard. All responses are ephemeral — kudos
 * totals are visible to whoever asks, but giving/viewing doesn't clutter the
 * channel.
 */
export class KudosCommand implements Command {
  public names = [Lang.getRef('chatCommands.kudos', Language.Default)]
  public cooldown = new RateLimiter(5, 30_000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  constructor(private readonly kudosService?: KudosService) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!this.kudosService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.kudosNotConfigured', data.lang),
      )
      return
    }

    switch (intr.options.getSubcommand()) {
      case KudosSubcommand.GIVE: {
        await this.give(intr, data, this.kudosService)
        break
      }
      case KudosSubcommand.VIEW: {
        await this.view(intr, data, this.kudosService)
        break
      }
      case KudosSubcommand.LEADERBOARD: {
        await this.leaderboard(intr, data, this.kudosService)
        break
      }
    }
  }

  private async give(
    intr: ChatInputCommandInteraction,
    data: EventData,
    kudosService: KudosService,
  ): Promise<void> {
    if (!intr.guild || !(intr.member instanceof GuildMember)) {
      await InteractionUtils.send(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    if (!RoleUtils.memberHasAnyConfiguredRole(intr.member, GIVE_ALLOWED_ROLE_IDS)) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('validationEmbeds.missingRole', data.lang, {
          ROLES: GIVE_ALLOWED_ROLE_IDS.map(getRoleNameById).join(', '),
        }),
      )
      return
    }

    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)
    const reason = intr.options.getString(Lang.getRef('arguments.reason', Language.Default))?.trim()

    if (targetUser.bot) {
      await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.kudosBotTarget', data.lang))
      return
    }

    const result = await kudosService.giveKudos(intr.guild.id, intr.user.id, targetUser.id, reason)

    switch (result.status) {
      case 'self': {
        await InteractionUtils.send(intr, Lang.getEmbed('displayEmbeds.kudosSelf', data.lang))
        return
      }
      case 'cooldown': {
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.kudosCooldown', data.lang, {
            USER: targetUser.toString(),
            RETRY_TIMESTAMP: Math.floor(result.retryAt.getTime() / 1000).toString(),
          }),
        )
        return
      }
      case 'given': {
        await InteractionUtils.send(
          intr,
          Lang.getEmbed('displayEmbeds.kudosGiven', data.lang, {
            USER: targetUser.toString(),
            TOTAL: result.total.toString(),
          }),
        )

        try {
          await targetUser.send({
            embeds: [
              Lang.getEmbed('displayEmbeds.kudosReceived', data.lang, {
                GIVER: intr.user.toString(),
                REASON: reason ? ` for: ${reason}` : '',
                TOTAL: result.total.toString(),
              }),
            ],
          })
        } catch (error) {
          if (
            error instanceof DiscordAPIError &&
            error.code === DiscordApiErrors.CannotSendMessagesToThisUser
          ) {
            // The receiver has DMs disabled or has blocked the bot; they can
            // still check their total with `/kudos view`.
          } else {
            Logger.error(
              `/kudos give: failed to DM ${targetUser.tag} their kudos notification`,
              error,
            )
          }
        }

        Logger.info(`${intr.user.tag} gave kudos to ${targetUser.tag}`)
        return
      }
    }
  }

  private async view(
    intr: ChatInputCommandInteraction,
    data: EventData,
    kudosService: KudosService,
  ): Promise<void> {
    const targetUser =
      intr.options.getUser(Lang.getRef('arguments.user', Language.Default)) ?? intr.user
    const total = await kudosService.getTotal(targetUser.id)

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.kudosView', data.lang, {
        USER: targetUser.toString(),
        TOTAL: total.toString(),
      }),
    )
  }

  private async leaderboard(
    intr: ChatInputCommandInteraction,
    data: EventData,
    kudosService: KudosService,
  ): Promise<void> {
    if (!intr.guild) {
      await InteractionUtils.send(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    const period = intr.options.getString(
      Lang.getRef('arguments.period', Language.Default),
      true,
    ) as KudosLeaderboardPeriod
    const periodLabel = Lang.getRef(
      period === 'weekly' ? 'kudosPeriods.weekly' : 'kudosPeriods.monthly',
      data.lang,
    )

    const entries = await kudosService.getLeaderboard(intr.guild.id, period)

    if (entries.length === 0) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.kudosLeaderboardEmpty', data.lang, {
          PERIOD_LABEL_LOWER: periodLabel.toLowerCase(),
        }),
      )
      return
    }

    const lines = entries.map((entry, index) => {
      const rank = MEDALS[index] ?? `${index + 1}.`
      return `${rank} <@${entry.receiverDiscordId}> — ${entry.total} Kudos`
    })

    await InteractionUtils.send(
      intr,
      Lang.getEmbed('displayEmbeds.kudosLeaderboard', data.lang, {
        PERIOD_LABEL: periodLabel,
        ENTRIES: lines.join('\n'),
      }),
    )
  }
}
