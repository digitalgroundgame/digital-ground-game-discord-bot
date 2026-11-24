import { type Message } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type TriggerHandler } from '../../src/events/trigger-handler.js'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('node-fetch', () => ({ default: fetchMock }))
vi.mock('../../src/services/logger.js', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { MessageHandler } from '../../src/events/message-handler.js'
import { CrmService } from '../../src/services/crm-service.js'

const BOT_ID = '923456789012345678'
const USER_ID = '123456789012345678'
const CHANNEL_ID = '323456789012345678'
const MESSAGE_ID = '423456789012345678'
const CREATED_AT = new Date('2026-11-08T12:00:00.000Z')

function message(overrides: {
  guildId?: string | null
  authorId?: string
  authorBot?: boolean
  system?: boolean
}): Message {
  return {
    id: MESSAGE_ID,
    channelId: CHANNEL_ID,
    guildId: overrides.guildId ?? null,
    system: overrides.system ?? false,
    createdAt: CREATED_AT,
    author: { id: overrides.authorId ?? USER_ID, bot: overrides.authorBot ?? false },
    client: { user: { id: BOT_ID } },
  } as unknown as Message
}

describe('MessageHandler', () => {
  let triggerHandler: TriggerHandler
  let crmService: CrmService

  beforeEach(() => {
    triggerHandler = { process: vi.fn(async () => {}) } as unknown as TriggerHandler
    crmService = { reportInboundDm: vi.fn(async () => {}) } as unknown as CrmService
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('forwards a DM to the CRM with its IDs and time, and still processes triggers', async () => {
    const msg = message({})

    await new MessageHandler(triggerHandler, crmService).process(msg)

    expect(crmService.reportInboundDm).toHaveBeenCalledTimes(1)
    expect(crmService.reportInboundDm).toHaveBeenCalledWith({
      message_id: MESSAGE_ID,
      channel_id: CHANNEL_ID,
      author_id: USER_ID,
      created_at: '2026-11-08T12:00:00.000Z',
    })
    expect(triggerHandler.process).toHaveBeenCalledWith(msg)
  })

  it('does not wait for the CRM before processing triggers', async () => {
    crmService.reportInboundDm = vi.fn(() => new Promise<void>(() => {}))

    await new MessageHandler(triggerHandler, crmService).process(message({}))

    expect(triggerHandler.process).toHaveBeenCalledTimes(1)
  })

  it('does not forward a guild message', async () => {
    const msg = message({ guildId: '523456789012345678' })

    await new MessageHandler(triggerHandler, crmService).process(msg)

    expect(crmService.reportInboundDm).not.toHaveBeenCalled()
    expect(triggerHandler.process).toHaveBeenCalledWith(msg)
  })

  it("does not forward the bot's own DMs", async () => {
    await new MessageHandler(triggerHandler, crmService).process(
      message({ authorId: BOT_ID, authorBot: true }),
    )

    expect(crmService.reportInboundDm).not.toHaveBeenCalled()
  })

  it('does not forward a DM from another bot', async () => {
    await new MessageHandler(triggerHandler, crmService).process(
      message({ authorId: '823456789012345678', authorBot: true }),
    )

    expect(crmService.reportInboundDm).not.toHaveBeenCalled()
  })

  it('does not forward a system message', async () => {
    await new MessageHandler(triggerHandler, crmService).process(message({ system: true }))

    expect(crmService.reportInboundDm).not.toHaveBeenCalled()
  })

  it('sends nothing when crm is disabled', async () => {
    const msg = message({})

    await new MessageHandler(triggerHandler).process(msg)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(triggerHandler.process).toHaveBeenCalledWith(msg)
  })
})
