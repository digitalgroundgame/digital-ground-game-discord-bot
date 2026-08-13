/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BackfillGrantsCommand } from '../../src/commands/chat/backfill-grants-command.js'
import { GoogleGroups } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { type GoogleGroupsService } from '../../src/services/google-groups-service.js'
import { UserService } from '../../src/services/user-service.js'
import { createMockGuildMember } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

/** A configured team, so the command's real config lookup resolves. */
const [TEAM, GROUP_ADDRESS] = Object.entries(GoogleGroups)[0]

/**
 * A deferred ChatInputCommandInteraction stub for /backfill-grants — deferred,
 * because the command handler always defers this one before `execute` runs, so
 * the command reports through `editReply`.
 */
function createInteraction(options: {
  service?: string
  team?: string | null
  dryRun?: boolean | null
}): any {
  const member = createMockGuildMember()
  const strings: Record<string, string | null> = {
    service: options.service ?? 'google',
    team: options.team ?? null,
  }
  return {
    user: member.user,
    member,
    deferred: true,
    replied: false,
    options: {
      getString: vi.fn((name: string) => strings[name] ?? null),
      getBoolean: vi.fn(() => options.dryRun ?? null),
    },
    reply: vi.fn().mockResolvedValue({}),
    editReply: vi.fn().mockResolvedValue({}),
    followUp: vi.fn().mockResolvedValue({}),
  }
}

/** The last embed description the command sent, whichever path it used. */
function lastDescription(intr: any): string | undefined {
  const calls = [...intr.editReply.mock.calls, ...intr.followUp.mock.calls]
  return calls.at(-1)?.[0]?.embeds?.[0]?.data?.description
}

function createGroupsService(emails: string[], configured = true): GoogleGroupsService {
  return {
    isConfigured: () => configured,
    listMemberEmails: vi.fn(async () => ({ status: 'ok' as const, emails })),
  } as unknown as GoogleGroupsService
}

describe('BackfillGrantsCommand', () => {
  const data = new EventData(Language.Default, Language.Default)
  let userService: UserService

  beforeEach(() => {
    userService = new UserService(createTestDatabase())
  })

  it('rejects an unsupported service without reading any group', async () => {
    const groupsService = createGroupsService([])
    const command = new BackfillGrantsCommand(groupsService, userService)
    const intr = createInteraction({ service: 'github' })

    await command.execute(intr, data)

    expect(lastDescription(intr)).toContain('github')
    expect(groupsService.listMemberEmails).not.toHaveBeenCalled()
  })

  it('reports not-configured when Google Groups has no credentials', async () => {
    const command = new BackfillGrantsCommand(createGroupsService([], false), userService)
    const intr = createInteraction({ team: TEAM })

    await command.execute(intr, data)

    expect(lastDescription(intr)).toContain("isn't configured")
  })

  it('reports not-configured without a database', async () => {
    const command = new BackfillGrantsCommand(createGroupsService([]), undefined)
    const intr = createInteraction({ team: TEAM })

    await command.execute(intr, data)

    expect(lastDescription(intr)).toContain("isn't configured")
  })

  it('backfills one team and reports its totals', async () => {
    const groupsService = createGroupsService(['a@example.org', 'b@example.org'])
    const command = new BackfillGrantsCommand(groupsService, userService)
    const intr = createInteraction({ team: TEAM })

    await command.execute(intr, data)

    expect(groupsService.listMemberEmails).toHaveBeenCalledWith(GROUP_ADDRESS)
    const description = lastDescription(intr) ?? ''
    expect(description).toContain('**2** member(s)')
    expect(description).toContain('**2** grant(s) recorded')
    expect(description).toContain(TEAM)
    expect(await userService.listPendingAccessGrants('google', 'a@example.org')).toHaveLength(1)
  })

  it('writes nothing on a dry run and says so', async () => {
    const command = new BackfillGrantsCommand(createGroupsService(['a@example.org']), userService)
    const intr = createInteraction({ team: TEAM, dryRun: true })

    await command.execute(intr, data)

    expect(lastDescription(intr)).toContain('dry run')
    expect(await userService.listPendingAccessGrants('google', 'a@example.org')).toEqual([])
  })

  it('sweeps every configured team when none is given', async () => {
    const groupsService = createGroupsService([])
    const command = new BackfillGrantsCommand(groupsService, userService)
    const intr = createInteraction({})

    await command.execute(intr, data)

    expect(groupsService.listMemberEmails).toHaveBeenCalledTimes(Object.keys(GoogleGroups).length)
    expect(lastDescription(intr)).toContain(`**${Object.keys(GoogleGroups).length}** team group(s)`)
  })

  it('warns when a team could not be read', async () => {
    const groupsService = {
      isConfigured: () => true,
      listMemberEmails: vi.fn(async () => ({
        status: 'error' as const,
        message: 'Not Authorized',
      })),
    } as unknown as GoogleGroupsService
    const command = new BackfillGrantsCommand(groupsService, userService)
    const intr = createInteraction({ team: TEAM })

    await command.execute(intr, data)

    const description = lastDescription(intr) ?? ''
    expect(description).toContain('**1** couldn')
    expect(description).toContain('Not Authorized')
  })

  it('reports a team whose group read throws as a failure, not a crash', async () => {
    const groupsService = {
      isConfigured: () => true,
      listMemberEmails: vi.fn(() => {
        throw new Error('boom')
      }),
    } as unknown as GoogleGroupsService
    const command = new BackfillGrantsCommand(groupsService, userService)
    const intr = createInteraction({ team: TEAM })

    await command.execute(intr, data)

    expect(lastDescription(intr)).toContain('the group could not be read')
  })
})
