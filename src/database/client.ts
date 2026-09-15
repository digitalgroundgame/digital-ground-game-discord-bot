import Sqlite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import * as schema from './schema.js'

export type Database = BetterSQLite3Database<typeof schema>

function ensureDatabaseDirectory(filename: string): void {
  if (filename === ':memory:' || filename.startsWith('file:')) {
    return
  }
  mkdirSync(dirname(filename), { recursive: true })
}

export function createDatabase(filename = process.env.SQLITE_PATH): Database {
  if (!filename) {
    throw new Error('SQLITE_PATH is not set')
  }
  ensureDatabaseDirectory(filename)
  const sqlite = new Sqlite(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}
