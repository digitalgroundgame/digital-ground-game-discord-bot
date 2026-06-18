import { fileURLToPath } from 'node:url'

import Sqlite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema.js'

export type Database = BetterSQLite3Database<typeof schema>

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export function createDatabase(filename = process.env.SQLITE_PATH): Database {
  if (!filename) {
    throw new Error('SQLITE_PATH is not set')
  }
  const sqlite = new Sqlite(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder })
  return database
}
