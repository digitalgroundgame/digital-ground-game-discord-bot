import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/database/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.SQLITE_PATH,
  },
  strict: process.env.DRIZZLE_STRICT !== 'false',
  verbose: true,
})
