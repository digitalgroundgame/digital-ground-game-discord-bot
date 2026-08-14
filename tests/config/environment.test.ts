import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDeveloperIds, validateEnv } from '../../src/config/environment.js'

const VALID_ID = '123456789012345678'

const ALL_VARS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_API_SECRET',
  'DISCORD_BOT_MASTER_API_TOKEN',
  'DISCORD_BOT_DEVELOPER_IDS',
  'CRM_API_URL',
  'CRM_API_TOKEN',
] as const

function stubEnv(values: Partial<Record<(typeof ALL_VARS)[number], string>>): void {
  for (const envVar of ALL_VARS) {
    vi.stubEnv(envVar, values[envVar] ?? '')
  }
}

describe('validateEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('bot mode', () => {
    it('passes with the bot variables set', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_DEVELOPER_IDS: VALID_ID,
        CRM_API_URL: 'http://localhost:8080',
        CRM_API_TOKEN: 'crm-token',
      })

      expect(() => validateEnv('bot')).not.toThrow()
    })

    it('does not require manager or commands variables', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_DEVELOPER_IDS: VALID_ID,
        CRM_API_URL: 'http://localhost:8080',
        CRM_API_TOKEN: 'crm-token',
      })

      // DISCORD_CLIENT_ID, DISCORD_BOT_API_SECRET, and
      // DISCORD_BOT_MASTER_API_TOKEN are unset above.
      expect(() => validateEnv('bot')).not.toThrow()
    })

    it('requires the CRM variables while crm is enabled in config', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_DEVELOPER_IDS: VALID_ID,
      })

      expect(() => validateEnv('bot')).toThrow(/CRM_API_URL, CRM_API_TOKEN/)
    })

    it('rejects an empty developer ID list', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_DEVELOPER_IDS: ' , ',
        CRM_API_URL: 'http://localhost:8080',
        CRM_API_TOKEN: 'crm-token',
      })

      expect(() => validateEnv('bot')).toThrow(/at least one ID/)
    })

    it('rejects developer IDs that are not snowflakes', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_DEVELOPER_IDS: `${VALID_ID},not-a-snowflake`,
        CRM_API_URL: 'http://localhost:8080',
        CRM_API_TOKEN: 'crm-token',
      })

      expect(() => validateEnv('bot')).toThrow(/not-a-snowflake/)
    })
  })

  describe('manager mode', () => {
    it('passes with the manager variables set', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_BOT_API_SECRET: 'secret',
      })

      // DISCORD_BOT_MASTER_API_TOKEN stays unset: clustering is disabled in
      // config, so it must not be required.
      expect(() => validateEnv('manager')).not.toThrow()
    })

    it('requires the API secret', () => {
      stubEnv({ DISCORD_BOT_TOKEN: 'token' })

      expect(() => validateEnv('manager')).toThrow(/DISCORD_BOT_API_SECRET/)
    })

    it('reports all missing variables in one error', () => {
      stubEnv({})

      expect(() => validateEnv('manager')).toThrow(/DISCORD_BOT_TOKEN, DISCORD_BOT_API_SECRET/)
    })
  })

  describe('commands mode', () => {
    it('passes with the token and client ID set', () => {
      stubEnv({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'client-id',
      })

      expect(() => validateEnv('commands')).not.toThrow()
    })

    it('requires the client ID', () => {
      stubEnv({ DISCORD_BOT_TOKEN: 'token' })

      expect(() => validateEnv('commands')).toThrow(/DISCORD_CLIENT_ID/)
    })
  })

  describe('calendar mode', () => {
    it('requires only the token', () => {
      stubEnv({ DISCORD_BOT_TOKEN: 'token' })

      expect(() => validateEnv('calendar')).not.toThrow()
    })

    it('requires the token', () => {
      stubEnv({})

      expect(() => validateEnv('calendar')).toThrow(/DISCORD_BOT_TOKEN/)
    })
  })
})

describe('getDeveloperIds', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('splits and trims the configured IDs', () => {
    vi.stubEnv('DISCORD_BOT_DEVELOPER_IDS', ` ${VALID_ID} , 987654321098765432 `)

    expect(getDeveloperIds()).toEqual([VALID_ID, '987654321098765432'])
  })

  it('returns an empty list when unset', () => {
    vi.stubEnv('DISCORD_BOT_DEVELOPER_IDS', '')

    expect(getDeveloperIds()).toEqual([])
  })
})
