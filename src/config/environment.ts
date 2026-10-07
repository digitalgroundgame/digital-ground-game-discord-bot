import { config } from 'dotenv'

if (process.env.NODE_ENV !== 'production') {
  config()
}

const requiredEnvVars = [
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'DISCORD_BOT_API_SECRET',
  'DISCORD_BOT_MASTER_API_TOKEN',
  'DISCORD_BOT_DEVELOPER_IDS',
] as const

export function validateEnv(): void {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`)
    }
  }

  // 17-20 digits: snowflakes crossed 19 digits in 2023 and 20 is the ceiling for
  // a 64-bit id. Matches `DISCORD_ID_REGEX` and `users-controller`'s check.
  const snowflakePattern = /^\d{17,20}$/

  if (!snowflakePattern.test(process.env.DISCORD_GUILD_ID)) {
    // Caught here rather than as a 404 on every /users request later.
    throw new Error(`Invalid Discord ID in DISCORD_GUILD_ID: ${process.env.DISCORD_GUILD_ID}`)
  }

  const developerIds = process.env.DISCORD_BOT_DEVELOPER_IDS.split(',').map((id) => id.trim())
  if (developerIds.length === 0) {
    throw new Error('DISCORD_BOT_DEVELOPER_IDS must contain at least one ID')
  }
  for (const id of developerIds) {
    if (!snowflakePattern.test(id)) {
      throw new Error(`Invalid Discord ID in DISCORD_BOT_DEVELOPER_IDS: ${id}`)
    }
  }
}

validateEnv()

export function getDeveloperIds(): string[] {
  return process.env.DISCORD_BOT_DEVELOPER_IDS.split(',').map((id) => id.trim())
}
