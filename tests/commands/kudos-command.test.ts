/* eslint-disable @typescript-eslint/no-explicit-any */
import { Collection } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandDeferType } from '../../src/commands/index.js'
import { KudosCommand } from '../../src/commands/chat/kudos-command.js'
import { ServerRoles } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { KudosService } from '../../src/services/kudos-service.js'
import { Logger } from '../../src/services/logger.js'
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

function announcement(intr: any): any {
  return intr.followUp.mock.calls[0]?.[0]
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
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target, false)

    await command.execute(intr, data)

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    expect(intr.followUp).toHaveBeenCalledOnce()
  })

  it('confirms privately to the giver and announces publicly, pinging only the receiver', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service, ADMIN_ONLY)
    const target = createMockUser({
      id: '222333444555666777',
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    const description = intr.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain('They now have **1** kudos')

    expect(intr.followUp).toHaveBeenCalledOnce()
    const message = announcement(intr)
    expect(message.flags).toBeUndefined()
    // The masked link in the reason is escaped so it can't disguise a URL.
    expect(message.content).toBe(
      '🪙 <@333444555666777888> gave <@222333444555666777> kudos: \\[great work](https://example.com)',
    )
    expect(message.allowedMentions).toEqual({ users: ['222333444555666777'] })
    expect(target.send).not.toHaveBeenCalled()
  })

  it('announces without a reason when none is given', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service, ADMIN_ONLY)
    const target = createMockUser({
      id: '222333444555666777',
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target)
    intr.options.getString.mockReturnValue(null)

    await command.execute(intr, data)

    expect(announcement(intr).content).toBe(
      '🪙 <@333444555666777888> gave <@222333444555666777> kudos!',
    )
  })

  it('keeps the recorded give and the giver confirmation when the announcement fails', async () => {
    const error = vi.spyOn(Logger, 'error').mockImplementation(() => {})
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service, ADMIN_ONLY)
    const target = createMockUser({
      id: '222333444555666777',
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })
    const intr = createGiveInteraction('333444555666777888', target)
    intr.followUp.mockRejectedValue(new Error('Missing Access'))

    await expect(command.execute(intr, data)).resolves.toBeUndefined()

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
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
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })

    const first = createGiveInteraction('333444555666777888', target)
    await new KudosCommand(service).execute(first, data)

    const second = createGiveInteraction('333444555666777888', target)
    await new KudosCommand(service).execute(second, data)

    expect(await service.getTotal(GUILD_ID, target.id)).toBe(1)
    expect(second.followUp).not.toHaveBeenCalled()
    const description = second.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(description).toContain('already gave')
  })

  it('rejects a self-give without recording or announcing it', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const giverId = '333444555666777888'
    const target = createMockUser({
      id: giverId,
      toString: vi.fn().mockReturnValue(`<@${giverId}>`),
    })
    const intr = createGiveInteraction(giverId, target)

    await command.execute(intr, data)

    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(intr.followUp).not.toHaveBeenCalled()
    expect(await service.getTotal(GUILD_ID, giverId)).toBe(0)
  })

  it('shows a not-configured message and never touches the database when kudos has no service', async () => {
    const command = new KudosCommand(undefined)
    const target = createMockUser({ id: '222333444555666777' })
    const intr = createGiveInteraction('333444555666777888', target)

    await command.execute(intr, data)

    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(intr.followUp).not.toHaveBeenCalled()
  })

  it('collapses a multi-line reason so it stays on the announcement line', async () => {
    const db = createTestDatabase()
    const service = new KudosService(db)
    const command = new KudosCommand(service)
    const target = createMockUser({
      id: '222333444555666777',
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })

    const forgedReason = 'nice work\n# Free Nitro: click here\n- <@999888777666555444> is fired'
    const intr = createGiveInteraction('333444555666777888', target, true, forgedReason)

    await command.execute(intr, data)

    const message = announcement(intr)
    expect(message.content).not.toContain('\n')
    expect(message.content).toContain(
      'kudos: nice work # Free Nitro: click here - <@999888777666555444> is fired',
    )
    // The mention inside the reason renders but does not ping.
    expect(message.allowedMentions).toEqual({ users: ['222333444555666777'] })
  })
})
