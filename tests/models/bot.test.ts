import { type Client } from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Bot } from '../../src/models/bot.js'
import { type JobService, Logger } from '../../src/services/index.js'

function createMockClient(login: ReturnType<typeof vi.fn>): Client {
  return {
    on: vi.fn(),
    login,
    destroy: vi.fn().mockResolvedValue(undefined),
    rest: { on: vi.fn() },
  } as unknown as Client
}

function stub<T>(): T {
  return {} as T
}

function createBot(client: Client): Bot {
  return new Bot(
    'test-token',
    client,
    stub(),
    stub(),
    stub(),
    stub(),
    stub(),
    stub(),
    stub(),
    stub(),
    stub(),
    stub<JobService>(),
  )
}

describe('Bot', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(() => {})
    vi.spyOn(Logger, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs in successfully on start', async () => {
    const login = vi.fn().mockResolvedValue('test-token')
    const client = createMockClient(login)
    const bot = createBot(client)

    await bot.start()

    expect(login).toHaveBeenCalledWith('test-token')
    expect(client.destroy).not.toHaveBeenCalled()
  })

  it('rethrows a login failure and destroys the client', async () => {
    const error = new Error('invalid token')
    const login = vi.fn().mockRejectedValue(error)
    const client = createMockClient(login)
    const bot = createBot(client)

    await expect(bot.start()).rejects.toBe(error)

    expect(client.destroy).toHaveBeenCalledOnce()
  })

  it('rethrows the login failure even when destroying the client fails', async () => {
    const error = new Error('invalid token')
    const login = vi.fn().mockRejectedValue(error)
    const client = createMockClient(login)
    vi.mocked(client.destroy).mockRejectedValue(new Error('destroy failed'))
    const bot = createBot(client)

    await expect(bot.start()).rejects.toBe(error)
  })
})
