declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DISCORD_CLIENT_ID: string
      DISCORD_BOT_TOKEN: string
      DISCORD_BOT_API_SECRET: string
      DISCORD_BOT_CONTROL_API_SECRET: string
      DISCORD_BOT_MASTER_API_TOKEN: string
      DISCORD_BOT_DEVELOPER_IDS: string // comma-separated list of Discord user IDs
      DISCORD_GUILD_ID?: string // required when Google Calendar sync is enabled
      INTEGRATION_DM_PROXY?: string // unset disables the /integrations/send-dm endpoint
      PORT?: string // overrides config.api.port when set (injected by the hosting platform)
      SQLITE_PATH: string
      NODE_ENV: 'development' | 'production' | 'test'
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {}
