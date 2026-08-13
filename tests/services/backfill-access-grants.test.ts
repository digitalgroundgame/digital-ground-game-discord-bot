import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  backfillAccessGrants,
  type BackfillTeamResult,
} from '../../src/services/backfill-access-grants.js'
import {
  type GoogleGroupsService,
  type ListMembersResult,
} from '../../src/services/google-groups-service.js'
import { UserService } from '../../src/services/user-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GROUPS = {
  welcome: 'welcome@example.org',
  organizers: 'organizers@example.org',
}

/**
 * A stand-in for the Directory-backed service: `members` maps a group address to
 * the result `listMemberEmails` should return, either as a plain email list or as
 * a full discriminated result for the error paths.
 */
function createGroupsService(members: Record<string, string[] | ListMembersResult>): {
  service: GoogleGroupsService
  listMemberEmails: ReturnType<typeof vi.fn>
} {
  const listMemberEmails = vi.fn(async (groupEmail: string): Promise<ListMembersResult> => {
    const entry = members[groupEmail]
    if (entry === undefined) return { status: 'error', message: `no stub for ${groupEmail}` }
    return Array.isArray(entry) ? { status: 'ok', emails: entry } : entry
  })
  return { service: { listMemberEmails } as unknown as GoogleGroupsService, listMemberEmails }
}

describe('backfillAccessGrants', () => {
  let userService: UserService

  beforeEach(() => {
    userService = new UserService(createTestDatabase())
  })

  it('records a real grant for a member whose address is already linked', async () => {
    await userService.linkAccount('user-1', 'google', {
      externalId: 'linked@example.org',
      email: 'linked@example.org',
    })
    const { service } = createGroupsService({ 'welcome@example.org': ['linked@example.org'] })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
    })

    expect(summary.granted).toBe(1)
    expect(summary.pending).toBe(0)
    expect(summary.recorded).toBe(1)
    const grants = await userService.listAccessGrants('user-1')
    expect(grants).toHaveLength(1)
    expect(grants[0].team).toBe('welcome')
    expect(grants[0].groupAddress).toBe('welcome@example.org')
  })

  it('records a pending grant for a member nobody has linked', async () => {
    const { service } = createGroupsService({ 'welcome@example.org': ['stranger@example.org'] })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
    })

    expect(summary.granted).toBe(0)
    expect(summary.pending).toBe(1)
    expect(summary.recorded).toBe(1)
    const pending = await userService.listPendingAccessGrants('google', 'stranger@example.org')
    expect(pending).toHaveLength(1)
    expect(pending[0].team).toBe('welcome')
  })

  it('is idempotent across runs', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': ['stranger@example.org'],
    })
    const options = { teams: ['welcome'], groups: GROUPS }

    await backfillAccessGrants(service, userService, options)
    const second = await backfillAccessGrants(service, userService, options)

    expect(second.recorded).toBe(1)
    expect(
      await userService.listPendingAccessGrants('google', 'stranger@example.org'),
    ).toHaveLength(1)
  })

  it('dedupes and lowercases the addresses a group reports', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': ['dupe@example.org', 'dupe@example.org'],
    })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
    })

    expect(summary.members).toBe(1)
    expect(summary.recorded).toBe(1)
    expect(await userService.listPendingAccessGrants('google', 'dupe@example.org')).toHaveLength(1)
  })

  it('reports counts without writing on a dry run', async () => {
    const { service } = createGroupsService({ 'welcome@example.org': ['stranger@example.org'] })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
      dryRun: true,
    })

    expect(summary.dryRun).toBe(true)
    expect(summary.recorded).toBe(1)
    expect(await userService.listPendingAccessGrants('google', 'stranger@example.org')).toEqual([])
  })

  it('defaults to every team in the injected group map', async () => {
    const { service, listMemberEmails } = createGroupsService({
      'welcome@example.org': [],
      'organizers@example.org': [],
    })

    const summary = await backfillAccessGrants(service, userService, { groups: GROUPS })

    expect(listMemberEmails).toHaveBeenCalledTimes(2)
    expect(summary.teams.map((team) => team.team)).toEqual(['welcome', 'organizers'])
  })

  it('processes only the requested teams', async () => {
    const { service, listMemberEmails } = createGroupsService({ 'organizers@example.org': [] })

    await backfillAccessGrants(service, userService, { teams: ['organizers'], groups: GROUPS })

    expect(listMemberEmails).toHaveBeenCalledTimes(1)
    expect(listMemberEmails).toHaveBeenCalledWith('organizers@example.org')
  })

  it('fails an unknown team without stopping the rest of the sweep', async () => {
    const { service } = createGroupsService({ 'welcome@example.org': ['stranger@example.org'] })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['nope', 'welcome'],
      groups: GROUPS,
    })

    expect(summary.failed).toBe(1)
    expect(summary.teams[0]).toMatchObject({
      team: 'nope',
      status: 'error',
      message: 'unknown team',
    })
    expect(summary.teams[1]).toMatchObject({ team: 'welcome', status: 'ok', recorded: 1 })
  })

  it('fails a team whose group cannot be read, and writes nothing for it', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': { status: 'error', message: 'boom' },
    })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
    })

    expect(summary.failed).toBe(1)
    expect(summary.recorded).toBe(0)
    expect(summary.teams[0]).toMatchObject({ status: 'error', message: 'boom' })
  })

  it('reports an unconfigured provider as a team failure', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': { status: 'not-configured' },
    })

    const summary = await backfillAccessGrants(service, userService, {
      teams: ['welcome'],
      groups: GROUPS,
    })

    expect(summary.teams[0]).toMatchObject({
      status: 'error',
      message: 'Google Groups not configured',
    })
  })

  it('fails a team whose group read throws, and keeps sweeping', async () => {
    const listMemberEmails = vi.fn(async (groupEmail: string): Promise<ListMembersResult> => {
      if (groupEmail === 'welcome@example.org') throw new Error('boom')
      return { status: 'ok', emails: ['stranger@example.org'] }
    })
    const service = { listMemberEmails } as unknown as GoogleGroupsService

    const summary = await backfillAccessGrants(service, userService, { groups: GROUPS })

    expect(summary.failed).toBe(1)
    expect(summary.teams[0]).toMatchObject({
      team: 'welcome',
      status: 'error',
      message: 'the group could not be read',
    })
    expect(summary.teams[1]).toMatchObject({ team: 'organizers', status: 'ok', recorded: 1 })
  })

  it('reports progress once per team', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': [],
      'organizers@example.org': [],
    })
    const seen: [string, number, number][] = []

    await backfillAccessGrants(service, userService, {
      groups: GROUPS,
      onTeamComplete: (result: BackfillTeamResult, done: number, total: number) => {
        seen.push([result.team, done, total])
      },
    })

    expect(seen).toEqual([
      ['welcome', 1, 2],
      ['organizers', 2, 2],
    ])
  })

  it('finishes the sweep even when reporting progress throws', async () => {
    const { service } = createGroupsService({
      'welcome@example.org': [],
      'organizers@example.org': ['stranger@example.org'],
    })

    const summary = await backfillAccessGrants(service, userService, {
      groups: GROUPS,
      onTeamComplete: () => {
        throw new Error('discord is down')
      },
    })

    expect(summary.teams).toHaveLength(2)
    expect(summary.recorded).toBe(1)
  })
})
