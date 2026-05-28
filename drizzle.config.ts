import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/database/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.SQLITE_PATH,
  },
  strict: true,
  verbose: true,
})
