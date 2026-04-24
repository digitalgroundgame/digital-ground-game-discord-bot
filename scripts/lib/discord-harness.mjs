/**
 * Shared helpers for scripts that call the Discord HTTP API.
 * Add more call wrappers here as you build out the local harness.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { REST } from '@discordjs/rest'
import { config } from 'dotenv'
import { Routes } from 'discord.js'

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Load `scripts/.env` and return common settings.
 * @returns {{ token: string, guildId: string | null }}
 */
export function loadScriptsEnv() {
  const envPath = join(scriptsDir, '.env')
  const { error } = config({ path: envPath, override: false })
  if (error && error.code !== 'ENOENT') {
    console.error(`[discord-harness] could not read ${envPath}:`, error.message)
  }
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token?.trim()) {
    throw new Error('DISCORD_BOT_TOKEN is required in scripts/.env (or the environment)')
  }
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || null
  return { token: token.trim(), guildId }
}

/**
 * @param {string} token
 * @returns {import('@discordjs/rest').REST}
 */
export function createRest(token) {
  return new REST({ version: '10' }).setToken(token)
}

/**
 * Resolve guild id: use DISCORD_GUILD_ID when set; otherwise if the bot is in exactly one guild, use that.
 * @param {import('@discordjs/rest').REST} rest
 * @param {string | null} explicitGuildId
 * @returns {Promise<string>}
 */
export async function resolveGuildId(rest, explicitGuildId) {
  if (explicitGuildId) {
    return explicitGuildId
  }
  /** @type {Array<{ id: string, name: string }>} */
  const guilds = (await rest.get(Routes.userGuilds())) || []
  if (guilds.length === 0) {
    throw new Error('This bot is not in any servers (invite it first) or the token is invalid')
  }
  if (guilds.length === 1) {
    return guilds[0].id
  }
  console.error('Set DISCORD_GUILD_ID in scripts/.env. This bot is in more than one server:')
  for (const g of guilds) {
    console.error(`  — ${g.name} (${g.id})`)
  }
  throw new Error('DISCORD_GUILD_ID is required when the bot is in more than one server')
}

/**
 * List [guild scheduled events](https://discord.com/developers/docs/resources/guild-scheduled-event#list-scheduled-events-for-guild)
 * for a guild.
 * @param {import('@discordjs/rest').REST} rest
 * @param {string} guildId
 * @param {{ withUserCount?: boolean }} [options]
 */
export async function listGuildScheduledEvents(rest, guildId, options = {}) {
  const { withUserCount = true } = options
  const query = withUserCount ? new URLSearchParams({ with_user_count: 'true' }) : undefined
  return rest.get(Routes.guildScheduledEvents(guildId), { query })
}
