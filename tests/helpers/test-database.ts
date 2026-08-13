import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from '../../src/database/schema.js'

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

/** In-memory database mirroring the schema created by `npm run db:push`. */
export function createTestDatabase(): TestDatabase {
  const sqlite = new Sqlite(':memory:')
  // SQLite ignores foreign keys unless asked; `createDatabase` enables them, so
  // without this the FKs and cascades below would be inert in tests only.
  sqlite.pragma('foreign_keys = ON')
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

    CREATE TABLE "access_grant" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "linked_account_id" integer NOT NULL,
      "team" text NOT NULL,
      "group_address" text NOT NULL,
      "granted_at" integer NOT NULL DEFAULT (unixepoch()),
      "updated_at" integer NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY ("linked_account_id") REFERENCES "linked_account" ("id") ON DELETE cascade
    );
    CREATE UNIQUE INDEX "access_grant_account_team_uq"
      ON "access_grant" ("linked_account_id", "team");

    CREATE TABLE "pending_access_grant" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "provider" text NOT NULL,
      "email" text NOT NULL,
      "team" text NOT NULL,
      "group_address" text NOT NULL,
      "discovered_at" integer NOT NULL DEFAULT (unixepoch()),
      "updated_at" integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX "pending_access_grant_provider_email_team_uq"
      ON "pending_access_grant" ("provider", "email", "team");

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
