declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Required in every runtime mode; validated by validateEnv() at each
      // entry point.
      DISCORD_BOT_TOKEN: string
      // Required per mode/capability — see src/config/environment.ts.
      DISCORD_CLIENT_ID?: string // commands CLI
      DISCORD_BOT_API_SECRET?: string // manager
      DISCORD_BOT_MASTER_API_TOKEN?: string // manager, when clustering is enabled
      DISCORD_BOT_DEVELOPER_IDS?: string // bot; comma-separated list of Discord user IDs
      CRM_API_URL?: string // bot, when crm is enabled
      CRM_API_TOKEN?: string // bot, when crm is enabled
      // Optional integrations and overrides.
      INTEGRATION_DM_PROXY?: string // unset disables the /integrations/send-dm endpoint
      PORT?: string // overrides config.api.port when set (injected by the hosting platform)
      SQLITE_PATH?: string // unset disables the database-backed features
      GOOGLE_CALENDAR_ID?: string
      GOOGLE_CALENDAR_CREDENTIALS?: string
      GOOGLE_APPLICATION_CREDENTIALS?: string
      GOOGLE_CALENDAR_IMPERSONATION_SUBJECT?: string
      GOOGLE_WORKSPACE_ADMIN_SUBJECT?: string
      NODE_ENV: 'development' | 'production' | 'test'
    }
  }
}

// If this file has no import/export statements (i.e. is a script)
// convert it into a module by adding an empty export statement.
export {}
