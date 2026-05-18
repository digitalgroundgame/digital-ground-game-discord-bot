import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  decodeGoogleOAuthState,
  encodeGoogleOAuthState,
  type GoogleOAuthState,
} from '../../src/utils/google-oauth-state.js'

vi.mock('../../config/config.json', () => ({}))
vi.mock('../../config/debug.json', () => ({}))
vi.mock('../../lang/logs.json', () => ({}))

const originalSecret = process.env.DISCORD_BOT_API_SECRET

beforeAll(() => {
  process.env.DISCORD_BOT_API_SECRET = 'test-secret'
})

afterAll(() => {
  process.env.DISCORD_BOT_API_SECRET = originalSecret
})

function makeState(overrides: Partial<GoogleOAuthState> = {}): GoogleOAuthState {
  return {
    discordUserId: '123456789012345678',
    groupShortname: 'media-team',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe('googleOAuthState', () => {
  it('round-trips a valid state token', () => {
    const state = makeState()
    const decoded = decodeGoogleOAuthState(encodeGoogleOAuthState(state))
    expect(decoded).toEqual(state)
  })

  it('rejects an expired token', () => {
    const token = encodeGoogleOAuthState(makeState({ expiresAt: Date.now() - 1 }))
    expect(decodeGoogleOAuthState(token)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = encodeGoogleOAuthState(makeState())
    const [, signature] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify(makeState({ groupShortname: 'admins' })),
      'utf-8',
    ).toString('base64url')
    expect(decodeGoogleOAuthState(`${forgedPayload}.${signature}`)).toBeNull()
  })

  it('rejects malformed and empty tokens', () => {
    expect(decodeGoogleOAuthState(undefined)).toBeNull()
    expect(decodeGoogleOAuthState('')).toBeNull()
    expect(decodeGoogleOAuthState('no-dot')).toBeNull()
  })
})
