import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { GrantAccessAllowedRoleKeys, type ServerRole, ServerRoles } from '../../constants/index.js'
import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import {
  backfillAccessGrants,
  type BackfillSummary,
  type BackfillTeamResult,
  type GoogleGroupsService,
  Lang,
  Logger,
  type UserService,
} from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

/**
 * Don't edit the progress reply more often than this. A sweep of small groups
 * finishes a team in well under a second, and every edit is a REST call against
 * the interaction's own rate limit.
 */
const PROGRESS_EDIT_INTERVAL_MS = 1500

/** Teams listed in the progress body; enough to show movement without a wall of text. */
const PROGRESS_DETAIL_LINES = 5

/**
 * One line per team, e.g. `**Event Team** — 14 member(s), 14 recorded`. Truncated
 * to `limit` teams with a trailing count so a full sweep of every configured
 * group still fits inside an embed description.
 */
function formatTeamLines(teams: readonly BackfillTeamResult[], limit?: number): string {
  const shown = limit === undefined ? teams : teams.slice(-limit)
  const lines = shown.map((result) =>
    result.status === 'ok'
      ? `**${result.team}** — ${result.members} member(s), ${result.recorded} recorded`
      : `**${result.team}** — ⚠️ ${result.message ?? 'failed'}`,
  )
  const hidden = teams.length - shown.length
  if (hidden > 0) lines.unshift(`_…${hidden} earlier team(s)_`)
  return lines.join('\n')
}

/**
 * Records the real membership of the configured team Google Groups as access
 * grants, so `/users/:id` reports access the bot didn't grant itself — members
 * added by hand in the Workspace admin console, or before the bot existed.
 *
 * Members whose Google address is already linked get a real grant. Members
 * nobody has linked yet get a pending grant keyed on their address, which
 * `/link-account` materializes when they eventually link it.
 */
export class BackfillGrantsCommand implements Command {
  public names = [Lang.getRef('chatCommands.backfillGrants', Language.Default)]
  public cooldown = new RateLimiter(1, 60000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []
  public requireRoles = GrantAccessAllowedRoleKeys.map(
    (key) => (ServerRoles as Record<string, ServerRole | undefined>)[key]?.id,
  ).filter((id): id is string => typeof id === 'string')

  constructor(
    private readonly groupsService?: GoogleGroupsService,
    private readonly userService?: UserService,
  ) {}

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    const service = intr.options.getString(Lang.getRef('arguments.service', Language.Default), true)
    const team = intr.options.getString(Lang.getRef('arguments.team', Language.Default))
    const dryRun =
      intr.options.getBoolean(Lang.getRef('arguments.dryRun', Language.Default)) ?? false

    // Only Google is supported today; the option choices already enforce this.
    if (service !== 'google') {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.backfillGrantsUnknownService', data.lang, {
          SERVICE: service,
        }),
        true,
      )
      return
    }

    const groupsService = this.groupsService
    const userService = this.userService
    if (!groupsService?.isConfigured() || !userService) {
      await InteractionUtils.send(
        intr,
        Lang.getEmbed('displayEmbeds.backfillGrantsNotConfigured', data.lang),
        true,
      )
      return
    }

    const dryRunNote = dryRun ? ' _(dry run — nothing written)_' : ''
    const finished: BackfillTeamResult[] = []
    let lastEditAt = 0

    let summary: BackfillSummary
    try {
      summary = await backfillAccessGrants(groupsService, userService, {
        teams: team ? [team] : undefined,
        dryRun,
        onTeamComplete: async (result, done, total) => {
          finished.push(result)
          // Throttled, and never for the last team — the final summary lands next.
          const now = Date.now()
          if (done === total || now - lastEditAt < PROGRESS_EDIT_INTERVAL_MS) return
          lastEditAt = now
          await InteractionUtils.editReply(
            intr,
            Lang.getEmbed('displayEmbeds.backfillGrantsProgress', data.lang, {
              DONE: done.toString(),
              TOTAL: total.toString(),
              DRY_RUN: dryRunNote,
              DETAILS: formatTeamLines(finished, PROGRESS_DETAIL_LINES),
            }),
          )
        },
      })
    } catch (err: unknown) {
      Logger.error(`/backfill-grants: failed (team: ${team ?? 'all'}, dryRun: ${dryRun})`, err)
      await InteractionUtils.editReply(
        intr,
        Lang.getEmbed('displayEmbeds.backfillGrantsFailed', data.lang),
      )
      return
    }

    Logger.info(
      `${intr.user.tag} ran /backfill-grants (team: ${team ?? 'all'}, dryRun: ${dryRun}) — ` +
        `${summary.recorded} grant(s) recorded, ${summary.failed} team(s) failed`,
    )

    const ref =
      summary.failed > 0
        ? 'displayEmbeds.backfillGrantsPartial'
        : 'displayEmbeds.backfillGrantsComplete'
    await InteractionUtils.editReply(
      intr,
      Lang.getEmbed(ref, data.lang, {
        TEAM_COUNT: summary.teams.length.toString(),
        MEMBERS: summary.members.toString(),
        RECORDED: summary.recorded.toString(),
        FAILED: summary.failed.toString(),
        DRY_RUN: dryRunNote,
        DETAILS: formatTeamLines(summary.teams),
      }),
    )
  }
}
