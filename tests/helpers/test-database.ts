import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '../../src/database/schema.js'

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

/** In-memory database with the content_override table (mirrors `npm run db:push`). */
export function createTestDatabase(): TestDatabase {
  const sqlite = new Sqlite(':memory:')
  sqlite.exec(`
    CREATE TABLE content_override (
      id integer PRIMARY KEY AUTOINCREMENT,
      key text NOT NULL,
      field text NOT NULL,
      value text NOT NULL,
      updated_by text NOT NULL,
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX content_override_key_field_uq ON content_override (key, field);
  `)
  return drizzle(sqlite, { schema })
}
