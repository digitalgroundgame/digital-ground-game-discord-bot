import { google } from 'googleapis'
import { type OAuth2Client } from 'google-auth-library'

import { GOOGLE_OAUTH_SCOPES } from '../constants/index.js'
import { Logger } from './logger.js'

export type ResolveEmailResult =
  | { status: 'ok'; email: string; subject: string }
  | { status: 'unverified' }
  | { status: 'error'; message: string }

/**
 * Drives the user-facing Google Sign-In (OAuth) flow used to confirm the Workspace
 * identity of a Discord user before adding them to a group.
 *
 * This is a standard Web OAuth client (client ID + secret + redirect URI) — separate
 * from the service account used by {@link GoogleGroupsService}.
 */
export class GoogleOAuthService {
  private clientId: string | undefined
  private clientSecret: string | undefined
  private redirectUri: string | undefined

  constructor(
    clientId: string | undefined,
    clientSecret: string | undefined,
    redirectUri: string | undefined,
  ) {
    this.clientId = clientId?.trim() || undefined
    this.clientSecret = clientSecret?.trim() || undefined
    this.redirectUri = redirectUri?.trim() || undefined
  }

  /** True when client ID, secret, and redirect URI are all set. */
  public isConfigured(): boolean {
    return (
      this.clientId !== undefined &&
      this.clientSecret !== undefined &&
      this.redirectUri !== undefined
    )
  }

  private newClient(): OAuth2Client | null {
    if (!this.isConfigured()) return null
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri)
  }

  /**
   * Build the Google consent URL the user follows to sign in. The signed `state` token
   * is round-tripped back to the callback unchanged.
   */
  public buildAuthUrl(state: string): string | null {
    const client = this.newClient()
    if (!client) return null
    return client.generateAuthUrl({
      access_type: 'online',
      scope: [...GOOGLE_OAUTH_SCOPES],
      include_granted_scopes: false,
      prompt: 'select_account',
      state,
    })
  }

  /**
   * Exchange the authorization `code` for tokens and extract the signed-in user's
   * verified email address.
   */
  public async resolveEmailFromCode(code: string): Promise<ResolveEmailResult> {
    const client = this.newClient()
    if (!client) return { status: 'error', message: 'OAuth client is not configured.' }
    try {
      const { tokens } = await client.getToken(code)
      if (!tokens.id_token) {
        return { status: 'error', message: 'No id_token returned from Google.' }
      }
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.clientId,
      })
      const payload = ticket.getPayload()
      const email = payload?.email
      const subject = payload?.sub
      if (!email || !subject) {
        return { status: 'error', message: 'No email or subject present in the Google identity.' }
      }
      if (payload?.email_verified === false) {
        return { status: 'unverified' }
      }
      return { status: 'ok', email, subject }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      Logger.error(`Google OAuth: failed to resolve email from authorization code: ${message}`, err)
      return { status: 'error', message }
    }
  }
}
