#!/usr/bin/env node
/**
 * List Discord [scheduled events](https://discord.com/developers/docs/resources/guild-scheduled-event) for a server.
 *
 * Environment (from `scripts/.env` and/or the process environment):
 * - DISCORD_BOT_TOKEN (required)
 * - DISCORD_GUILD_ID (optional; required if the bot is in more than one server; otherwise the sole guild is used)
 *
 * Usage: `node scripts/list-scheduled-events.mjs`
 */
import {
  createRest,
  listGuildScheduledEvents,
  loadScriptsEnv,
  resolveGuildId,
} from './lib/discord-harness.mjs'

async function main() {
  const { token, guildId: envGuildId } = loadScriptsEnv()
  const rest = createRest(token)
  const guildId = await resolveGuildId(rest, envGuildId)
  const events = await listGuildScheduledEvents(rest, guildId)
  console.log(JSON.stringify(events, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
