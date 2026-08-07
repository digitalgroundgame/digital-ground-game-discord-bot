import { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandsController } from '../../src/controllers/commands-controller.js'
import {
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
  type CommandRegistrationAction,
  type CommandRegistrationSummary,
} from '../../src/models/control-api/command-registration.js'
import { Api } from '../../src/models/api.js'

const CONTROL_SECRET = 'test-control-secret'
const commandSummary = {
  localAndRemote: ['help'],
  localOnly: [],
  remoteOnly: [],
}

function buildApp(
  calls: Array<{ action: CommandRegistrationAction; args: string[] }>,
  requestError?: Error,
): Express {
  const controller = new CommandsController({
    async request(
      action: CommandRegistrationAction,
      args: string[] = [],
    ): Promise<CommandRegistrationSummary | undefined> {
      calls.push({ action, args })
      if (requestError) {
        throw requestError
      }
      return action === 'view' ? commandSummary : undefined
    },
  })
  return new Api([controller]).app
}

describe('CommandsController', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_BOT_CONTROL_API_SECRET', CONTROL_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires control API authentication', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls)).post('/commands/register').send({})

    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('refuses to mount without a control API secret', () => {
    vi.stubEnv('DISCORD_BOT_CONTROL_API_SECRET', '')

    expect(() => buildApp([])).toThrow(/auth token/)
  })

  it('registers commands through the authenticated control API', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls))
      .post('/commands/register')
      .set('Authorization', CONTROL_SECRET)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'register', success: true })
    expect(calls).toEqual([{ action: 'register', args: [] }])
  })

  it('requires explicit confirmation before clearing every command', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls))
      .delete('/commands')
      .set('Authorization', CONTROL_SECRET)
      .send({})

    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('views the command state', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls)).get('/commands').set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'view', success: true, commands: commandSummary })
    expect(calls).toEqual([{ action: 'view', args: [] }])
  })

  it('forwards a confirmed clear and command rename', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const app = buildApp(calls)

    const clearRes = await request(app)
      .delete('/commands')
      .set('Authorization', CONTROL_SECRET)
      .send({ confirm: true })
    const renameRes = await request(app)
      .patch('/commands/old-name')
      .set('Authorization', CONTROL_SECRET)
      .send({ name: 'new-name' })

    expect(clearRes.status).toBe(200)
    expect(renameRes.status).toBe(200)
    expect(calls).toEqual([
      { action: 'clear', args: [] },
      { action: 'rename', args: ['old-name', 'new-name'] },
    ])
  })

  it('reports a missing remote command as not found', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const error = new CommandRegistrationNotFoundError(
      "Could not find a command with the name 'missing'.",
    )

    const res = await request(buildApp(calls, error))
      .delete('/commands/missing')
      .set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: error.message })
    expect(calls).toEqual([{ action: 'delete', args: ['missing'] }])
  })

  it('reports a shard-side argument error as a bad request', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const error = new CommandRegistrationInvalidArgumentError('Missing command name.')

    const res = await request(buildApp(calls, error))
      .post('/commands/register')
      .set('Authorization', CONTROL_SECRET)

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: error.message })
  })
})
