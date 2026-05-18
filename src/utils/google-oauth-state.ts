import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed payload round-tripped through Google's OAuth `state` parameter so the callback
 * knows which Discord user to link and which group to add them to.
 */
export interface GoogleOAuthState {
  /** Discord user ID being added to the group. */
  discordUserId: string
  /** Command group shortname (key in `config.googleAdd.groups`). */
  groupShortname: string
  /** Unix epoch (ms) after which the state is no longer accepted. */
  expiresAt: number
}

/** State tokens older than this are rejected on the callback. */
export const GOOGLE_OAUTH_STATE_TTL_MS = 15 * 60 * 1000

function getSecret(): string {
  const secret = process.env.DISCORD_BOT_API_SECRET
  if (!secret) {
    throw new Error('DISCORD_BOT_API_SECRET is required to sign Google OAuth state tokens.')
  }
  return secret
}

function sign(data: string): string {
  return createHmac('sha256', getSecret()).update(data).digest('base64url')
}

/** Encode and HMAC-sign an OAuth state token: `<payload>.<signature>`. */
export function encodeGoogleOAuthState(state: GoogleOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state), 'utf-8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Verify and decode an OAuth state token. Returns null if invalid, tampered, or expired. */
export function decodeGoogleOAuthState(token: string | undefined | null): GoogleOAuthState | null {
  if (!token) return null
  const dotIndex = token.indexOf('.')
  if (dotIndex <= 0) return null

  const payload = token.slice(0, dotIndex)
  const signature = token.slice(dotIndex + 1)

  const expected = sign(payload)
  const expectedBuf = Buffer.from(expected)
  const signatureBuf = Buffer.from(signature)
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    return null
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    if (
      typeof o.discordUserId !== 'string' ||
      typeof o.groupShortname !== 'string' ||
      typeof o.expiresAt !== 'number'
    ) {
      return null
    }
    if (Date.now() > o.expiresAt) return null
    return {
      discordUserId: o.discordUserId,
      groupShortname: o.groupShortname,
      expiresAt: o.expiresAt,
    }
  } catch {
    return null
  }
}
