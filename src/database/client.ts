import Sqlite from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema.js'

export type Database = BetterSQLite3Database<typeof schema>

// Connects to the SQLite database. Schema migrations are applied separately by
// `dist/migrate.js` (see `npm run db:migrate`), which runs as a deploy gate
// before the bot starts — not here, so the per-shard processes never race to
// migrate the same file.
export function createDatabase(filename = process.env.SQLITE_PATH): Database {
  if (!filename) {
    throw new Error('SQLITE_PATH is not set')
  }
  const sqlite = new Sqlite(filename)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}
