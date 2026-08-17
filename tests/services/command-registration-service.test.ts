import { type REST } from '@discordjs/rest'
import { describe, expect, it, vi } from 'vitest'

import {
  CommandRegistrationInvalidArgumentError,
  CommandRegistrationNotFoundError,
} from '../../src/models/control-api/command-registration.js'
import { CommandRegistrationService } from '../../src/services/command-registration-service.js'

vi.mock('../../src/config/environment.js', () => ({}))

function buildService(): CommandRegistrationService {
  const rest = {
    get: vi.fn().mockResolvedValue([{ id: 'remote-id', name: 'existing-command' }]),
  } as unknown as REST

  return new CommandRegistrationService(rest)
}

describe('CommandRegistrationService', () => {
  it('rejects rename and delete requests with missing arguments', async () => {
    const service = buildService()

    await expect(
      service.process([], ['node', 'start-bot', 'commands', 'rename', 'existing-command']),
    ).rejects.toBeInstanceOf(CommandRegistrationInvalidArgumentError)
    await expect(
      service.process([], ['node', 'start-bot', 'commands', 'delete']),
    ).rejects.toBeInstanceOf(CommandRegistrationInvalidArgumentError)
  })

  it('rejects rename and delete requests for a missing remote command', async () => {
    const service = buildService()

    await expect(
      service.process([], ['node', 'start-bot', 'commands', 'rename', 'missing', 'replacement']),
    ).rejects.toBeInstanceOf(CommandRegistrationNotFoundError)
    await expect(
      service.process([], ['node', 'start-bot', 'commands', 'delete', 'missing']),
    ).rejects.toBeInstanceOf(CommandRegistrationNotFoundError)
  })
})
