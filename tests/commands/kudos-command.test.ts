/* eslint-disable @typescript-eslint/no-explicit-any */
import { Collection } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KudosCommand } from '../../src/commands/chat/kudos-command.js'
import { ServerRoles } from '../../src/constants/index.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { KudosService } from '../../src/services/kudos-service.js'
import {
  createMockCommandInteraction,
  createMockGuildMember,
  createMockUser,
} from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const data = new EventData(Language.Default, Language.Default)

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
    const command = new KudosCommand(service)
    const target = createMockUser({ id: '222333444555666777' })
    const intr = createGiveInteraction('333444555666777888', target, false)

    await command.execute(intr, data)

    expect(intr.editReply).toHaveBeenCalledOnce()
    expect(intr.followUp).not.toHaveBeenCalled()
    expect(target.send).not.toHaveBeenCalled()
    expect(await service.getTotal(GUILD_ID, target.id)).toBe(0)
  })

  it('edits one receiver DM when multiple people give kudos within an hour', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))

    const db = createTestDatabase()
    const service = new KudosService(db)
    const firstCommand = new KudosCommand(service)
    const edit = vi.fn().mockResolvedValue({})
    const fetch = vi.fn().mockResolvedValue({ edit })
    const target = createMockUser({
      id: '222333444555666777',
      send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch } }),
      toString: vi.fn().mockReturnValue('<@222333444555666777>'),
    })

    const first = createGiveInteraction('333444555666777888', target)
    await firstCommand.execute(first, data)

    vi.setSystemTime(new Date('2026-09-16T16:30:00Z'))
    const restartedCommand = new KudosCommand(service)
    const second = createGiveInteraction('444555666777888999', target)
    await restartedCommand.execute(second, data)

    expect(first.editReply).toHaveBeenCalledOnce()
    expect(second.editReply).toHaveBeenCalledOnce()
    expect(first.followUp).not.toHaveBeenCalled()
    expect(second.followUp).not.toHaveBeenCalled()
    expect(target.send).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('dm-message-1')
    expect(edit).toHaveBeenCalledOnce()

    const firstDm = target.send.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(firstDm).toContain('**1** kudos')
    expect(firstDm).toContain('<@333444555666777888>')
    expect(firstDm).toContain('\\[great work](https://example.com)')

    const updatedDm = edit.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(updatedDm).toContain('**2** kudos')
    expect(updatedDm).toContain('<@333444555666777888>')
    expect(updatedDm).toContain('<@444555666777888999>')
    expect(updatedDm).toContain('You now have **2** kudos')
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
      'nice work\n• <@999888777666555444> — you\'re fired, see DMs\n# Free Nitro: click here'
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
})
