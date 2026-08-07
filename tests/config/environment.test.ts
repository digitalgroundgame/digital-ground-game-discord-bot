import { afterEach, describe, expect, it, vi } from 'vitest'

function stubRequiredEnvironment(apiSecret: string, controlSecret: string): void {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('DISCORD_CLIENT_ID', '123456789012345678')
  vi.stubEnv('DISCORD_BOT_TOKEN', 'bot-token')
  vi.stubEnv('DISCORD_BOT_API_SECRET', apiSecret)
  vi.stubEnv('DISCORD_BOT_CONTROL_API_SECRET', controlSecret)
  vi.stubEnv('DISCORD_BOT_MASTER_API_TOKEN', 'master-token')
  vi.stubEnv('DISCORD_BOT_DEVELOPER_IDS', '123456789012345678')
}

describe('environment validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('accepts distinct API and control secrets', async () => {
    stubRequiredEnvironment('api-secret', 'control-secret')

    await expect(import('../../src/config/environment.js')).resolves.toBeDefined()
  })

  it('rejects matching API and control secrets', async () => {
    stubRequiredEnvironment('shared-secret', 'shared-secret')

    await expect(import('../../src/config/environment.js')).rejects.toThrow(
      'DISCORD_BOT_CONTROL_API_SECRET must differ from DISCORD_BOT_API_SECRET',
    )
  })
})
