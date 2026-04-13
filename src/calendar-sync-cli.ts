import { Events, Options, Partials } from 'discord.js'
import { createRequire } from 'node:module'

import './config/environment.js'
import { CustomClient } from './extensions/index.js'
import { GoogleCalendarService } from './services/index.js'
import { syncDggpScheduledEventsToGoogle } from './services/sync-dggp-google-calendar.js'

const require = createRequire(import.meta.url)
const Config = require('../config/config.json')

/**
 * Log in once, run a full Discord ↔ Google Calendar reconcile, then disconnect.
 * Used by `npm run calendar:sync` / `node dist/start-bot.js calendar sync`.
 */
export async function runCalendarSyncCli(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not set')
  }

  const client = new CustomClient({
    intents: Config.client.intents,
    partials: (Config.client.partials as string[]).map((partial) => Partials[partial]),
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      ...Config.client.caches,
    }),
    enforceNonce: true,
  })

  const googleCalendarService = new GoogleCalendarService(
    process.env.GOOGLE_CALENDAR_ID,
    process.env.GOOGLE_CALENDAR_CREDENTIALS ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_CALENDAR_IMPERSONATION_SUBJECT,
  )

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out after 60s waiting for Discord ClientReady'))
    }, 60_000)

    client.once(Events.ClientReady, () => {
      clearTimeout(timeout)
      void (async () => {
        try {
          await syncDggpScheduledEventsToGoogle(client, googleCalendarService)
          resolve()
        } catch (err) {
          reject(err)
        } finally {
          client.destroy()
        }
      })()
    })

    client.login(token).catch((err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}
