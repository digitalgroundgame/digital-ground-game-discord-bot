import { fileURLToPath } from 'node:url'

import Sqlite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema.js'

export type Database = BetterSQLite3Database<typeof schema>

// `drizzle/` sits at the project root, alongside `src/` (and `dist/` at
// runtime). Resolve it relative to this module so the path holds whether we run
// compiled from `dist/database/` (production) or `src/database/` (tests/dev).
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export function createDatabase(filename = process.env.SQLITE_PATH): Database {
  if (!filename) {
    throw new Error('SQLITE_PATH is not set')
  }
  const sqlite = new Sqlite(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const database = drizzle(sqlite, { schema })
  // Apply pending schema migrations on startup so a freshly provisioned or
  // out-of-date database (e.g. a new table added in a release) is migrated
  // before the bot reads from it. The baseline migration is idempotent, so this
  // is safe against databases first built with `drizzle-kit push`.
  migrate(database, { migrationsFolder })
  return database
}
