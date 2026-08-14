import { config } from 'dotenv'
import { createRequire } from 'node:module'

if (process.env.NODE_ENV !== 'production') {
  config()
}

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * The processes this codebase can start as. Each mode requires only the
 * environment variables it actually reads at runtime.
 */
export type RuntimeMode = 'bot' | 'manager' | 'commands' | 'calendar'

const modeEnvVars: Record<RuntimeMode, string[]> = {
  bot: ['DISCORD_BOT_TOKEN', 'DISCORD_BOT_DEVELOPER_IDS'],
  manager: ['DISCORD_BOT_TOKEN', 'DISCORD_BOT_API_SECRET'],
  commands: ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID'],
  calendar: ['DISCORD_BOT_TOKEN'],
}

export function getDeveloperIds(): string[] {
  return (process.env.DISCORD_BOT_DEVELOPER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

export function validateEnv(mode: RuntimeMode): void {
  const required = [...modeEnvVars[mode]]
  if (mode === 'manager' && Config.clustering.enabled) {
    required.push('DISCORD_BOT_MASTER_API_TOKEN')
  }
  if (mode === 'bot' && Config.crm.enabled) {
    required.push('CRM_API_URL', 'CRM_API_TOKEN')
  }

  const missing = required.filter((envVar) => !process.env[envVar])
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) for ${mode} mode: ${missing.join(', ')}`,
    )
  }

  if (required.includes('DISCORD_BOT_DEVELOPER_IDS')) {
    const snowflakePattern = /^\d{17,19}$/
    const developerIds = getDeveloperIds()
    if (developerIds.length === 0) {
      throw new Error('DISCORD_BOT_DEVELOPER_IDS must contain at least one ID')
    }
    for (const id of developerIds) {
      if (!snowflakePattern.test(id)) {
        throw new Error(`Invalid Discord ID in DISCORD_BOT_DEVELOPER_IDS: ${id}`)
      }
    }
  }
}
