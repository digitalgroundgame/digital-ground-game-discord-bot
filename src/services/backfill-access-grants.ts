import { GoogleGroups } from '../constants/index.js'
import { type GoogleGroupsService, type ListMembersResult } from './google-groups-service.js'
import { Logger } from './logger.js'
import { type UserService } from './user-service.js'

/** Backfill only supports Google today — the one provider with groups to read. */
const PROVIDER = 'google' as const

export interface BackfillOptions {
  /** Team shortnames to process; defaults to every team in `config.grantAccess.groups`. */
  teams?: string[]
  /** Read the groups and report, but write nothing. */
  dryRun?: boolean
  /** Team shortname -> group address. Defaults to the configured groups. */
  groups?: Record<string, string>
  /**
   * Called after each team finishes, so a caller can report progress while the
   * sweep is still running. Failures are logged and ignored — a caller that
   * can't be reached must not abort the backfill.
   */
  onTeamComplete?: (result: BackfillTeamResult, done: number, total: number) => Promise<void> | void
}

export interface BackfillTeamResult {
  team: string
  groupAddress: string
  /** Members read from the group. */
  members: number
  /** Members whose email is already linked to a Discord user — recorded as real grants. */
  granted: number
  /** Members nobody has linked yet — recorded as pending pre-fills. */
  pending: number
  /** `granted + pending`: grants recorded, regardless of whether anyone has linked yet. */
  recorded: number
  status: 'ok' | 'error'
  message?: string
}

export interface BackfillSummary {
  teams: BackfillTeamResult[]
  members: number
  granted: number
  pending: number
  /** `granted + pending` across every team. */
  recorded: number
  /** Teams that could not be read or written. */
  failed: number
  dryRun: boolean
}

/**
 * Read and record one team's group membership. Never throws — a group that can't
 * be read or recorded is returned as a failed team so the rest of the sweep runs.
 */
async function backfillTeam(
  groupsService: GoogleGroupsService,
  userService: UserService,
  team: string,
  groupAddress: string | undefined,
  dryRun: boolean,
): Promise<BackfillTeamResult> {
  const failed = (address: string, message: string): BackfillTeamResult => ({
    team,
    groupAddress: address,
    members: 0,
    granted: 0,
    pending: 0,
    recorded: 0,
    status: 'error',
    message,
  })

  if (!groupAddress) {
    Logger.error(`backfill-grants: unknown team '${team}' — not in config.grantAccess.groups`)
    return failed('', 'unknown team')
  }

  let result: ListMembersResult
  try {
    result = await groupsService.listMemberEmails(groupAddress)
  } catch (err: unknown) {
    Logger.error(`backfill-grants: failed to read group ${groupAddress} for '${team}'`, err)
    return failed(groupAddress, 'the group could not be read')
  }

  if (result.status !== 'ok') {
    return failed(
      groupAddress,
      result.status === 'not-configured' ? 'Google Groups not configured' : result.message,
    )
  }

  // De-duplicate: a group can list the same address more than once across pages,
  // and `includeDerivedMembership` can surface someone both directly and via a
  // nested group.
  const members = new Set(result.emails)

  const teamResult: BackfillTeamResult = {
    team,
    groupAddress,
    members: members.size,
    granted: 0,
    pending: 0,
    recorded: 0,
    status: 'ok',
  }

  for (const email of members) {
    try {
      const linked = await userService.findLinkedAccountByEmail(PROVIDER, email)
      if (linked) {
        if (!dryRun) await userService.recordAccessGrant(linked.id, team, groupAddress)
        teamResult.granted += 1
      } else {
        if (!dryRun) {
          await userService.recordPendingAccessGrant(PROVIDER, email, team, groupAddress)
        }
        teamResult.pending += 1
      }
      teamResult.recorded += 1
    } catch (err: unknown) {
      Logger.error(`backfill-grants: failed to record '${team}' membership for ${email}`, err)
      teamResult.status = 'error'
      teamResult.message = 'one or more members could not be recorded'
    }
  }

  return teamResult
}

/**
 * Read the real membership of every known team group and record it in the
 * database, so grants are not limited to what `/grant-access` happened to do.
 *
 * A member whose email is already linked to a Discord user gets a real access
 * grant. A member nobody has linked yet gets a *pending* grant keyed on their
 * email — when they later link that Google account, `UserService.linkAccount`
 * materializes it, so their access is pre-filled rather than lost. The
 * distinction is bookkeeping only: both are reported as recorded grants, and
 * consumers of the users API cannot tell them apart.
 *
 * Idempotent: both writes upsert, so re-running only refreshes timestamps.
 */
export async function backfillAccessGrants(
  groupsService: GoogleGroupsService,
  userService: UserService,
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const dryRun = options.dryRun ?? false
  const groups = options.groups ?? GoogleGroups
  const teams = options.teams ?? Object.keys(groups)

  const summary: BackfillSummary = {
    teams: [],
    members: 0,
    granted: 0,
    pending: 0,
    recorded: 0,
    failed: 0,
    dryRun,
  }

  for (const team of teams) {
    const teamResult = await backfillTeam(groupsService, userService, team, groups[team], dryRun)

    if (teamResult.status === 'error') summary.failed += 1
    summary.members += teamResult.members
    summary.granted += teamResult.granted
    summary.pending += teamResult.pending
    summary.recorded += teamResult.recorded
    summary.teams.push(teamResult)

    if (teamResult.status === 'ok') {
      Logger.info(
        `backfill-grants: ${team} (${teamResult.groupAddress}) — ${teamResult.members} member(s), ` +
          `${teamResult.granted} linked, ${teamResult.pending} pending${dryRun ? ' [dry run]' : ''}`,
      )
    }

    if (options.onTeamComplete) {
      try {
        await options.onTeamComplete(teamResult, summary.teams.length, teams.length)
      } catch (err: unknown) {
        Logger.error(`backfill-grants: progress callback failed after team '${team}'`, err)
      }
    }
  }

  Logger.info(
    `backfill-grants: done — ${summary.members} member(s) across ${summary.teams.length} team(s): ` +
      `${summary.recorded} recorded (${summary.granted} linked, ${summary.pending} pending), ` +
      `${summary.failed} team(s) failed${dryRun ? ' [dry run — nothing written]' : ''}`,
  )

  return summary
}
