/**
 * One-time OAuth setup: opens a browser flow and writes refresh token to disk.
 *
 * Prerequisites:
 * - OAuth 2.0 Client ID (Desktop or Web) with Calendar API enabled
 * - Add redirect URI: http://127.0.0.1:34567/oauth2callback (or set GOOGLE_OAUTH_REDIRECT_URI)
 *
 * Run: npm run calendar:oauth
 */
import 'dotenv/config'
import { createServer } from 'node:http'
import { writeFile, readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { OAuth2Client } from 'google-auth-library'

import { GOOGLE_CALENDAR_OAUTH_REDIRECT_URI, GOOGLE_CALENDAR_SCOPES } from './constants/google-calendar-oauth.js'
import { parseGoogleCredentialsJson } from './utils/parse-google-calendar-credentials.js'

function defaultTokenPath(): string {
  return process.env.GOOGLE_CALENDAR_OAUTH_TOKEN_PATH ?? 'config/google-calendar-oauth-tokens.json'
}

function credentialsPath(): string {
  const p =
    process.env.GOOGLE_CALENDAR_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? ''
  if (!p) {
    throw new Error(
      'Set GOOGLE_CALENDAR_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS to the path of your OAuth client JSON (Download JSON from Google Cloud Console).',
    )
  }
  return p
}

async function main(): Promise<void> {
  const secretsPath = credentialsPath()
  const tokenPath = defaultTokenPath()
  const raw = await readFile(secretsPath, 'utf-8')
  const parsed = parseGoogleCredentialsJson(JSON.parse(raw) as unknown)
  if (!parsed || parsed.kind !== 'oauth_client') {
    throw new Error(
      `File is not an OAuth 2.0 client secret JSON (expected "installed" or "web" with client_id). Got: ${secretsPath}. Service account JSON uses a different flow.`,
    )
  }

  const redirectUri = GOOGLE_CALENDAR_OAUTH_REDIRECT_URI
  const redirectUrl = new URL(redirectUri)
  if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
    throw new Error(`Unsupported redirect URI: ${redirectUri}`)
  }
  const port = redirectUrl.port ? Number(redirectUrl.port) : 80
  const pathname = redirectUrl.pathname || '/'

  const oauth2Client = new OAuth2Client(parsed.clientId, parsed.clientSecret, redirectUri)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...GOOGLE_CALENDAR_SCOPES],
    prompt: 'consent',
  })

  console.info('')
  console.info('Open this URL in a browser (signed in as the Google account that owns the calendar):')
  console.info('')
  console.info(authUrl)
  console.info('')
  console.info(`Waiting for redirect to ${redirectUri} ...`)
  console.info('')

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const requestUrl = req.url ? new URL(req.url, `http://${req.headers.host}`) : null
        if (!requestUrl || requestUrl.pathname !== pathname) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const code = requestUrl.searchParams.get('code')
        if (!code) {
          res.statusCode = 400
          res.end('Missing code')
          server.close()
          reject(new Error('Authorization failed: no code in redirect'))
          return
        }
        const { tokens } = await oauth2Client.getToken(code)
        if (!tokens.refresh_token) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'text/plain')
          res.end(
            'No refresh_token returned. Revoke app access at https://myaccount.google.com/permissions and run this script again with prompt=consent.',
          )
          server.close()
          reject(new Error('No refresh_token in response'))
          return
        }
        await writeFile(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(
          '<p>Success. You can close this tab and return to the terminal.</p><p>Tokens saved to ' +
            tokenPath +
            '</p>',
        )
        server.close()
        console.info(`Saved tokens to ${tokenPath}`)
        resolve()
      } catch (e) {
        server.close()
        reject(e)
      }
    })
    server.listen(port, redirectUrl.hostname === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0', () => {
      console.info(`Listening on port ${port} for OAuth callback...`)
    })
    server.on('error', reject)
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
