import { type Request, type Response, Router } from 'express'

import { getGoogleGroupAddress } from '../constants/index.js'
import {
  type GoogleGroupsService,
  type GoogleOAuthService,
  Logger,
  type UserService,
} from '../services/index.js'
import { decodeGoogleOAuthState } from '../utils/google-oauth-state.js'
import { type Controller } from './index.js'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}h1{font-size:1.4rem}</style>',
    `</head><body><h1>${escapeHtml(title)}</h1><p>${body}</p></body></html>`,
  ].join('')
}

/**
 * Public callback endpoint for the Google Sign-In flow started by `/google-add`.
 *
 * Google redirects the signed-in user here with an authorization `code` and the signed
 * `state` token. This handler verifies the state, resolves the user's verified email,
 * and adds them to the configured Google Group via the service account.
 */
export class GoogleOAuthController implements Controller {
  public path = '/google'
  public router: Router = Router()

  constructor(
    private oauthService: GoogleOAuthService,
    private groupsService: GoogleGroupsService,
    private userService: UserService,
  ) {}

  public register(): void {
    this.router.get('/oauth/callback', (req, res) => this.handleCallback(req, res))
  }

  private async handleCallback(req: Request, res: Response): Promise<void> {
    const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined
    if (oauthError) {
      res
        .status(400)
        .send(
          page('Sign-in cancelled', 'You did not finish signing in, so no group was joined.'),
        )
      return
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    const stateToken = typeof req.query.state === 'string' ? req.query.state : undefined

    const state = decodeGoogleOAuthState(stateToken)
    if (!state) {
      res
        .status(400)
        .send(
          page(
            'Link expired',
            'This sign-in link is invalid or has expired. Ask a coordinator to run <code>/google-add</code> again.',
          ),
        )
      return
    }

    const groupAddress = getGoogleGroupAddress(state.groupShortname)
    if (!groupAddress) {
      res
        .status(400)
        .send(page('Unknown group', 'The requested Google Group is no longer configured.'))
      return
    }

    if (!code) {
      res
        .status(400)
        .send(page('Missing authorization', 'Google did not return an authorization code.'))
      return
    }

    const emailResult = await this.oauthService.resolveEmailFromCode(code)
    if (emailResult.status === 'unverified') {
      res
        .status(400)
        .send(page('Email not verified', 'Your Google email address is not verified.'))
      return
    }
    if (emailResult.status === 'error') {
      res
        .status(502)
        .send(page('Sign-in failed', 'Something went wrong confirming your Google account.'))
      return
    }

    // Persist the verified Discord ↔ Google link. A DB failure here must not
    // block the user-facing flow, so it is logged and swallowed.
    try {
      await this.userService.linkGoogleAccount(
        state.discordUserId,
        emailResult.email,
        emailResult.subject,
      )
    } catch (err: unknown) {
      Logger.error(
        `Google OAuth: failed to persist account link for Discord ${state.discordUserId}`,
        err,
      )
    }

    const addResult = await this.groupsService.addMember(groupAddress, emailResult.email)
    switch (addResult.status) {
      case 'added': {
        Logger.info(
          `Google Groups: added ${emailResult.email} to ${groupAddress} (Discord ${state.discordUserId})`,
        )
        res
          .status(200)
          .send(
            page(
              "You're in!",
              `<strong>${escapeHtml(emailResult.email)}</strong> has been added to <strong>${escapeHtml(state.groupShortname)}</strong>. You can close this tab.`,
            ),
          )
        return
      }
      case 'already-member': {
        res
          .status(200)
          .send(
            page(
              'Already a member',
              `<strong>${escapeHtml(emailResult.email)}</strong> is already in <strong>${escapeHtml(state.groupShortname)}</strong>. You can close this tab.`,
            ),
          )
        return
      }
      case 'not-configured': {
        res
          .status(503)
          .send(
            page(
              'Not configured',
              'Google Group management is not configured on the server. Please contact an administrator.',
            ),
          )
        return
      }
      default: {
        res
          .status(502)
          .send(
            page(
              'Could not add you',
              'We confirmed your Google account but could not add you to the group. Please contact a coordinator.',
            ),
          )
        return
      }
    }
  }
}
