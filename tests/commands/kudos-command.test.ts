/* eslint-disable @typescript-eslint/no-explicit-any */
import { Collection, DiscordAPIError, RESTJSONErrorCodes as DiscordApiErrors } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandDeferType } from '../../src/commands/index.js'
import { KudosCommand } from '../../src/commands/chat/kudos-command.js'
import { ServerRoles } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { KudosNotifier } from '../../src/services/kudos-notifier.js'
import { KudosService } from '../../src/services/kudos-service.js'
import {
  createMockCommandInteraction,
  createMockGuildMember,
  createMockUser,
} from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const data = new EventData(Language.Default, Language.Default)
const ADMIN_ONLY = { giveAllowedRoleIds: [ServerRoles.ADMIN.id] }

function createGiveInteraction(
  giverId: string,
  target: any,
  allowed: boolean = true,
  reason: string = '[great work](https://example.com)',
): any {
  const giver = createMockUser({
    id: giverId,
    tag: `giver-${giverId}`,
    toString: vi.fn().mockReturnValue(`<@${giverId}>`),
  })
  const guild = { id: GUILD_ID, name: 'Test Guild', roles: { cache: new Collection() } }
  const member = createMockGuildMember({ id: giverId, user: giver, guild })
  if (allowed) {
    member.roles.cache.set(ServerRoles.ADMIN.id, { id: ServerRoles.ADMIN.id })
  }

  return createMockCommandInteraction({
    user: giver,
    member,
    guild,
    deferred: true,
    options: {
      getSubcommand: vi.fn().mockReturnValue('give'),
      getUser: vi.fn().mockReturnValue(target),
      getString: vi.fn().mockReturnValue(reason),
    },
  })
}

describe('KudosCommand', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the giver response ephemeral and rejects unauthorized givers', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service, ADMIN_ONLY)
    const target = createMockUser({ id: '222333444555666777' })
    const intr = createGiveInteraction('333444555666777888', target, false)

    await command.execute(intr, data)

    expect(command.deferType).toBe(CommandDeferType.HIDDEN)
    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(intr.followUp).not.toHaveBeenCalled()
    expect(target.send).not.toHaveBeenCalled()
    expect(await service.getTotal(GUILD_ID, target.id)).toBe(0)

    const description = intr.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain(ServerRoles.ADMIN.name)
  })

  it('lets any member give kudos when no giver roles are configured', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service, { giveAllowedRoleIds: [] })
    const target = createMockUser({
      id: '222333444555666777',
      send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target, false)

    await command.execute(intr, data)

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    expect(target.send).toHaveBeenCalledOnce()
  })

  it('notifies the receiver through the shared notifier', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const notifier = new KudosNotifier(service)
    const notifySpy = vi.spyOn(notifier, 'notify').mockResolvedValue(true)
    const command = new KudosCommand(service, { ...ADMIN_ONLY, notifier })
    const target = createMockUser({
      id: '222333444555666777',
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    expect(notifySpy).toHaveBeenCalledWith(GUILD_ID, target, expect.any(Date), data.lang)
    const description = intr.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain('They now have **1** kudos')
  })

  it('rejects targeting a bot before recording a give', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const giveKudosSpy = vi.spyOn(service, 'giveKudos')
    const target = createMockUser({ id: '222333444555666777', bot: true })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    expect(giveKudosSpy).not.toHaveBeenCalled()
    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(await service.getTotal(GUILD_ID, target.id)).toBe(0)
  })

  it('shows a cooldown message without recording a second give', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const target = createMockUser({
      id: '222333444555666777',
      send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })

    const first = createGiveInteraction('333444555666777888', target)
    await new KudosCommand(service).execute(first, data)

    const second = createGiveInteraction('333444555666777888', target)
    await new KudosCommand(service).execute(second, data)

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    const description = second.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain('already gave')
  })

  it('rejects a self-give without recording it or notifying anyone', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const giverId = '333444555666777888'
    const target = createMockUser({
      id: giverId,
      send: vi.fn(),
      toString: vi.fn().mockReturnValue(`<@${giverId}>`),
    })
    const intr = createGiveInteraction(giverId, target)

    await command.execute(intr, data)

    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(target.send).not.toHaveBeenCalled()
    expect(await service.getTotal(GUILD_ID, giverId)).toBe(0)
  })

  it('shows a not-configured message and never touches the database when kudos has no service', async () => {
    const command = new KudosCommand(undefined)
    const target = createMockUser({ id: '222333444555666777' })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(target.send).not.toHaveBeenCalled()
  })

  it('collapses a multi-line reason so it cannot forge extra DM entries', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const target = createMockUser({
      id: '222333444555666777',
      send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })

    const forgedReason =
      "nice work\n• <@999888777666555444> — you're fired, see DMs\n# Free Nitro: click here"
    const intr = createGiveInteraction('333444555666777888', target, true, forgedReason)

    await command.execute(intr, data)

    expect(target.send).toHaveBeenCalledOnce()
    const dm = target.send.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description as string
    const lines = dm.split('\n')

    // The forged reason must not have split into separate lines: only the
    // genuine template lines ("received from:" / entry / blank / "now have")
    // should be present, and only one of them may start with the bullet.
    expect(lines).toHaveLength(4)
    expect(lines.filter((line) => line.startsWith('•'))).toHaveLength(1)
    expect(lines[1]).toContain('<@333444555666777888>')
    expect(lines[1]).not.toMatch(/^#/m)
  })

  it('still records the give and tells the giver when the receiver has DMs closed', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const blockedError = new DiscordAPIError(
      {
        message: 'Cannot send messages to this user',
        code: DiscordApiErrors.CannotSendMessagesToThisUser,
      },
      DiscordApiErrors.CannotSendMessagesToThisUser,
      403,
      'POST',
      '/channels/x/messages',
      { body: {}, files: undefined },
    )
    const target = createMockUser({
      id: '222333444555666777',
      send: vi.fn().mockRejectedValue(blockedError),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    expect(intr.editReply).toHaveBeenCalledOnce()
    const description = intr.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain("couldn't DM them")
  })
})
