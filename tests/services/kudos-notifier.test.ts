/* eslint-disable @typescript-eslint/no-explicit-any */
import { DiscordAPIError, RESTJSONErrorCodes as DiscordApiErrors } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Language } from '../../src/models/enum-helpers/index.js'
import { KudosNotifier } from '../../src/services/kudos-notifier.js'
import { KudosService } from '../../src/services/kudos-service.js'
import { createMockUser } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const GUILD_ID = '111222333444555666'
const RECEIVER_ID = '222333444555666777'

function createDiscordError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { message: 'Discord error', code },
    code,
    403,
    'POST',
    '/channels/x/messages',
    { body: {}, files: undefined },
  )
}

function createReceiver(overrides: any = {}): any {
  return createMockUser({
    id: RECEIVER_ID,
    send: vi.fn().mockResolvedValue({ id: 'dm-message-1' }),
    createDM: vi.fn().mockResolvedValue({ messages: { fetch: vi.fn() } }),
    toString: vi.fn().mockReturnValue(`<@${RECEIVER_ID}>`),
    ...overrides,
  })
}

async function give(
  service: KudosService,
  giverId: string,
  reason?: string,
  source?: { channelId: string; messageId: string },
): Promise<Date> {
  const result = await service.giveKudos(GUILD_ID, giverId, RECEIVER_ID, reason, source)
  if (result.status !== 'given') {
    throw new Error(`Expected kudos to be given, got ${result.status}`)
  }
  return result.givenAt
}

function sentDescription(receiver: any): string {
  return receiver.send.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description as string
}

describe('KudosNotifier', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('edits one receiver DM when multiple people give kudos within an hour', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))

    const service = new KudosService(createTestDatabase())
    const edit = vi.fn().mockResolvedValue({})
    const fetch = vi.fn().mockResolvedValue({ edit })
    const receiver = createReceiver({
      createDM: vi.fn().mockResolvedValue({ messages: { fetch } }),
    })

    const firstGivenAt = await give(
      service,
      '333444555666777888',
      '[great work](https://example.com)',
    )
    expect(
      await new KudosNotifier(service).notify(GUILD_ID, receiver, firstGivenAt, Language.Default),
    ).toBe(true)

    vi.setSystemTime(new Date('2026-09-16T16:30:00Z'))
    const secondGivenAt = await give(service, '444555666777888999')
    // A fresh notifier (e.g. after a restart) still finds the persisted DM.
    expect(
      await new KudosNotifier(service).notify(GUILD_ID, receiver, secondGivenAt, Language.Default),
    ).toBe(true)

    expect(receiver.send).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('dm-message-1')
    expect(edit).toHaveBeenCalledOnce()

    const firstDm = sentDescription(receiver)
    expect(firstDm).toContain('**1** kudos')
    expect(firstDm).toContain('<@333444555666777888>')
    expect(firstDm).toContain('\\[great work](https://example.com)')

    const updatedDm = edit.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description
    expect(updatedDm).toContain('**2** kudos')
    expect(updatedDm).toContain('<@333444555666777888>')
    expect(updatedDm).toContain('<@444555666777888999>')
    expect(updatedDm).toContain('You now have **2** kudos')
  })

  it('links to the source message for kudos given with a reaction', async () => {
    const service = new KudosService(createTestDatabase())
    const receiver = createReceiver()

    const givenAt = await give(service, '333444555666777888', undefined, {
      channelId: '555666777888999000',
      messageId: '666777888999000111',
    })
    await new KudosNotifier(service).notify(GUILD_ID, receiver, givenAt, Language.Default)

    const dm = sentDescription(receiver)
    expect(dm).toContain('<@333444555666777888>')
    expect(dm).toContain(
      `(https://discord.com/channels/${GUILD_ID}/555666777888999000/666777888999000111)`,
    )
  })

  it('sends a new DM when the previous batch message was deleted', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T16:00:00Z'))

    const service = new KudosService(createTestDatabase())
    const fetch = vi.fn().mockRejectedValue(createDiscordError(DiscordApiErrors.UnknownMessage))
    const receiver = createReceiver({
      send: vi
        .fn()
        .mockResolvedValueOnce({ id: 'dm-message-1' })
        .mockResolvedValueOnce({ id: 'dm-message-2' }),
      createDM: vi.fn().mockResolvedValue({ messages: { fetch } }),
    })
    const notifier = new KudosNotifier(service)

    await notifier.notify(GUILD_ID, receiver, await give(service, 'giver-1'), Language.Default)
    vi.setSystemTime(new Date('2026-09-16T16:10:00Z'))
    await notifier.notify(GUILD_ID, receiver, await give(service, 'giver-2'), Language.Default)

    expect(receiver.send).toHaveBeenCalledTimes(2)
    const replacement = receiver.send.mock.calls[1]?.[0]?.embeds?.[0]?.data?.description
    expect(replacement).toContain('**2** kudos')
  })

  it('returns false without throwing when the receiver has DMs closed', async () => {
    const service = new KudosService(createTestDatabase())
    const receiver = createReceiver({
      send: vi
        .fn()
        .mockRejectedValue(createDiscordError(DiscordApiErrors.CannotSendMessagesToThisUser)),
    })

    const givenAt = await give(service, '333444555666777888')

    expect(
      await new KudosNotifier(service).notify(GUILD_ID, receiver, givenAt, Language.Default),
    ).toBe(false)
  })

  it('serializes concurrent notifications for a receiver into one DM', async () => {
    const service = new KudosService(createTestDatabase())
    let resolveSend: (value: { id: string }) => void = () => {}
    const edit = vi.fn().mockResolvedValue({})
    const receiver = createReceiver({
      send: vi.fn().mockImplementation(() => new Promise((resolve) => (resolveSend = resolve))),
      createDM: vi.fn().mockResolvedValue({
        messages: { fetch: vi.fn().mockResolvedValue({ edit }) },
      }),
    })
    const notifier = new KudosNotifier(service)

    const firstGivenAt = await give(service, 'giver-1')
    const secondGivenAt = await give(service, 'giver-2')
    const first = notifier.notify(GUILD_ID, receiver, firstGivenAt, Language.Default)
    const second = notifier.notify(GUILD_ID, receiver, secondGivenAt, Language.Default)

    await vi.waitFor(() => expect(receiver.send).toHaveBeenCalledOnce())
    resolveSend({ id: 'dm-message-1' })

    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(receiver.send).toHaveBeenCalledOnce()
    expect(edit).toHaveBeenCalledOnce()
  })
})
