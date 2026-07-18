import express, { type Express } from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'

import { CommandsController } from '../../src/controllers/commands-controller.js'
import {
  type CommandRegistrationAction,
  type CommandRegistrationSummary,
} from '../../src/command-registration-control.js'

const commandSummary = {
  localAndRemote: ['help'],
  localOnly: [],
  remoteOnly: [],
}

function buildApp(calls: Array<{ action: CommandRegistrationAction; args: string[] }>): Express {
  const controller = new CommandsController({
    async request(
      action: CommandRegistrationAction,
      args: string[] = [],
    ): Promise<CommandRegistrationSummary | undefined> {
      calls.push({ action, args })
      return action === 'view' ? commandSummary : undefined
    },
  })
  controller.register()

  const app = express()
  app.use(express.json())
  app.use(controller.path, controller.router)
  return app
}

describe('CommandsController', () => {
  it('registers commands through the local control service', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls)).post('/commands/register').send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'register', success: true })
    expect(calls).toEqual([{ action: 'register', args: [] }])
  })

  it('requires explicit confirmation before clearing every command', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls)).delete('/commands').send({})

    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('views the command state', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const res = await request(buildApp(calls)).get('/commands')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'view', success: true, commands: commandSummary })
    expect(calls).toEqual([{ action: 'view', args: [] }])
  })

  it('forwards a confirmed clear and command rename', async () => {
    const calls: Array<{ action: CommandRegistrationAction; args: string[] }> = []
    const app = buildApp(calls)

    const clearRes = await request(app).delete('/commands').send({ confirm: true })
    const renameRes = await request(app)
      .patch('/commands/old-name')
      .send({ name: 'new-name' })

    expect(clearRes.status).toBe(200)
    expect(renameRes.status).toBe(200)
    expect(calls).toEqual([
      { action: 'clear', args: [] },
      { action: 'rename', args: ['old-name', 'new-name'] },
    ])
  })
})
