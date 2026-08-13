import { parse } from 'dotenv'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Note: importing this module runs `validateEnv()` once at load against the
// ambient environment. These tests re-invoke the exported function with stubbed
// values, which is how they reach the failure paths.
import { validateEnv } from '../../src/config/environment.js'

const REQUIRED_ENV_VARS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'DISCORD_BOT_API_SECRET',
  'DISCORD_BOT_MASTER_API_TOKEN',
  'DISCORD_BOT_DEVELOPER_IDS',
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('validateEnv', () => {
  it('accepts the values shipped in .env.example', () => {
    // Guards the `npm run copyconfig` path CI depends on (`cp .env.example .env`):
    // a new required var or format check that lands without updating the example
    // breaks every CI job at import time. Parsed from the file directly rather
    // than read off `process.env`, which locally holds a developer's own `.env`.
    const example = parse(
      readFileSync(fileURLToPath(new URL('../../.env.example', import.meta.url))),
    )

    for (const envVar of REQUIRED_ENV_VARS) {
      vi.stubEnv(envVar, example[envVar] ?? '')
    }

    expect(() => validateEnv()).not.toThrow()
  })

  it.each(REQUIRED_ENV_VARS)('throws when %s is missing', (envVar) => {
    vi.stubEnv(envVar, '')

    expect(() => validateEnv()).toThrow(`Missing required environment variable: ${envVar}`)
  })

  it.each([
    ['not a snowflake', 'my-guild'],
    ['too short', '1234567890123456'],
    ['too long', '123456789012345678901'],
    ['has whitespace', ' 123456789012345678'],
  ])('rejects a DISCORD_GUILD_ID that is %s', (_label, value) => {
    // Otherwise the bot boots fine and every /users request 404s instead.
    vi.stubEnv('DISCORD_GUILD_ID', value)

    expect(() => validateEnv()).toThrow(/Invalid Discord ID in DISCORD_GUILD_ID/)
  })

  it.each(['12345678901234567', '123456789012345678', '12345678901234567890'])(
    'accepts the %s-digit snowflake bound',
    (value) => {
      vi.stubEnv('DISCORD_GUILD_ID', value)

      expect(() => validateEnv()).not.toThrow()
    },
  )

  it('rejects a malformed developer id', () => {
    vi.stubEnv('DISCORD_BOT_DEVELOPER_IDS', '123456789012345678,nope')

    expect(() => validateEnv()).toThrow(/Invalid Discord ID in DISCORD_BOT_DEVELOPER_IDS/)
  })
})
