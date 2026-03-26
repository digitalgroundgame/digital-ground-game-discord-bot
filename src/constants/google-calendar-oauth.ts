/** Must match an "Authorized redirect URI" on your OAuth 2.0 client in Google Cloud Console. */
export const GOOGLE_CALENDAR_OAUTH_REDIRECT_URI =
  process.env.GOOGLE_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:34567/oauth2callback'

export const GOOGLE_CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'] as const
