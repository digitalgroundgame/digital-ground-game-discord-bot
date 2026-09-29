import { GuildMember, type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { KudosGiveAllowedRoleKeys, ServerRoles, getRoleNameById } from '../../constants/index.js'
import { KudosSubcommand } from '../../enums/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  type KudosLeaderboardPeriod,
  KudosNotifier,
  type KudosService,
  Lang,
  Logger,
} from '../../services/index.js'
import { InteractionUtils, RoleUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

const GIVE_ALLOWED_ROLE_IDS = KudosGiveAllowedRoleKeys.map((key) => ServerRoles[key].id)

export interface KudosCommandOptions {
  /** Shared with the kudos reaction so DMs to one receiver are serialized. */
  notifier?: KudosNotifier
  /** Roles allowed to give kudos; empty means anyone. Defaults to config. */
  giveAllowedRoleIds?: string[]
}

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
  private readonly notifier?: KudosNotifier
  private readonly giveAllowedRoleIds: string[]

  constructor(
    private readonly kudosService?: KudosService,
    options: KudosCommandOptions = {},
  ) {
    this.notifier = options.notifier ?? (kudosService ? new KudosNotifier(kudosService) : undefined)
    this.giveAllowedRoleIds = options.giveAllowedRoleIds ?? GIVE_ALLOWED_ROLE_IDS
  }

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    if (!this.kudosService || !this.notifier) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.kudosNotConfigured', data.lang),
      )
      return
    }

    switch (intr.options.getSubcommand()) {
      case KudosSubcommand.GIVE: {
        await this.give(intr, data, this.kudosService, this.notifier)
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
    notifier: KudosNotifier,
  ): Promise<void> {
    if (!intr.guild || !(intr.member instanceof GuildMember)) {
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    if (!RoleUtils.memberPassesRoleRestriction(intr.member, this.giveAllowedRoleIds)) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('validationEmbeds.missingRole', data.lang, {
          ROLES: this.giveAllowedRoleIds.map(getRoleNameById).join(', '),
        }),
      )
      return
    }

    const targetUser = intr.options.getUser(Lang.getRef('arguments.user', Language.Default), true)
    const reason = intr.options
      .getString(Lang.getRef('arguments.reason', Language.Default))
      ?.replace(/\s+/g, ' ')
      .trim()

    if (targetUser.bot) {
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.kudosBotTarget', data.lang),
      )
      return
    }

    const result = await kudosService.giveKudos(intr.guild.id, intr.user.id, targetUser.id, reason)

    switch (result.status) {
      case 'self': {
        await InteractionUtils.editReply(intr, Lang.getEmbed('displayEmbeds.kudosSelf', data.lang))
        return
      }
      case 'cooldown': {
        await InteractionUtils.editReply(
          intr,
          Lang.getEmbed('displayEmbeds.kudosCooldown', data.lang, {
            USER: targetUser.toString(),
            RETRY_TIMESTAMP: Math.floor(result.retryAt.getTime() / 1000).toString(),
          }),
        )
        return
      }
      case 'given': {
        const notified = await notifier.notify(intr.guild.id, targetUser, result.givenAt, data.lang)

        await InteractionUtils.editReply(
          intr,
          Lang.getEmbed(
            notified ? 'displayEmbeds.kudosGiven' : 'displayEmbeds.kudosGivenNoDm',
            data.lang,
            {
              USER: targetUser.toString(),
              TOTAL: result.total.toString(),
            },
          ),
        )

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
    if (!intr.guild) {
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
      return
    }

    const targetUser =
      intr.options.getUser(Lang.getRef('arguments.user', Language.Default)) ?? intr.user
    const total = await kudosService.getTotal(intr.guild.id, targetUser.id)

    await InteractionUtils.editReply(
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
      await InteractionUtils.editReply(intr, Lang.getEmbed('validationEmbeds.guildOnly', data.lang))
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
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.kudosLeaderboardEmpty', data.lang, {
          PERIOD: Lang.getRef(
            period === 'weekly' ? 'kudosPeriods.week' : 'kudosPeriods.month',
            data.lang,
          ),
        }),
      )
      return
    }

    const lines = entries.map((entry, index) => {
      const rank = MEDALS[index] ?? `${index + 1}.`
      return `${rank} <@${entry.receiverDiscordId}> — ${entry.total} Kudos`
    })

    await InteractionUtils.editReply(
      intr,
      Lang.getEmbed('displayEmbeds.kudosLeaderboard', data.lang, {
        PERIOD_LABEL: periodLabel,
        ENTRIES: lines.join('\n'),
      }),
    )
  }
}
