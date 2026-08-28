import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '../../src/database/schema.js'

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

/** In-memory database mirroring the schema created by `pnpm run db:push`. */
export function createTestDatabase(): TestDatabase {
  const sqlite = new Sqlite(':memory:')
  sqlite.exec(`
    CREATE TABLE "user" (
      "discord_user_id" text PRIMARY KEY,
      "created_at" integer NOT NULL DEFAULT (unixepoch()),
      "updated_at" integer NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE "linked_account" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "discord_user_id" text NOT NULL,
      "provider" text NOT NULL,
      "external_id" text NOT NULL,
      "email" text,
      "display_name" text,
      "linked_at" integer NOT NULL DEFAULT (unixepoch()),
      "updated_at" integer NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY ("discord_user_id") REFERENCES "user" ("discord_user_id") ON DELETE cascade
    );
    CREATE UNIQUE INDEX "linked_account_user_provider_uq"
      ON "linked_account" ("discord_user_id", "provider");
    CREATE UNIQUE INDEX "linked_account_provider_external_uq"
      ON "linked_account" ("provider", "external_id");

    CREATE TABLE "content_override" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "key" text NOT NULL,
      "field" text NOT NULL,
      "value" text NOT NULL,
      "updated_by" text NOT NULL,
      "updated_at" integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX "content_override_key_field_uq"
      ON "content_override" ("key", "field");
  `)
  return drizzle(sqlite, { schema })
}
