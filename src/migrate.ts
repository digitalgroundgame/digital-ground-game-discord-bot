import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import Sqlite from 'better-sqlite3'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './database/schema.js'

// Standalone migration runner. Intended to run as a deploy gate (Coolify's
// pre-deployment command: `node dist/migrate.js`) so a failed migration aborts
// the deploy and leaves the previous version serving. Before applying anything
// it snapshots the database, so a migration that succeeds but does the wrong
// thing (e.g. a botched data/destructive change) is still recoverable.
//
// Deliberately avoids importing `config/environment.ts`: this only needs
// SQLITE_PATH, not the bot's Discord credentials.

// Number of timestamped pre-migration snapshots to retain per database file.
const BACKUPS_TO_KEEP = 10

// Resolve `drizzle/` (project root) relative to this module: dist/migrate.js -> ../drizzle.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

function log(message: string): void {
  console.log(`[migrate] ${message}`)
}

/** Keep only the most recent BACKUPS_TO_KEEP snapshots for this database file. */
function pruneBackups(filename: string): void {
  const dir = dirname(filename)
  const prefix = `${basename(filename)}.`
  // ISO timestamps sort lexicographically in chronological order.
  const snapshots = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
    .sort()
  for (const f of snapshots.slice(0, Math.max(0, snapshots.length - BACKUPS_TO_KEEP))) {
    unlinkSync(join(dir, f))
    log(`Pruned old backup ${f}`)
  }
}

/** VACUUM INTO a timestamped snapshot beside the live file (consistent under WAL). */
function backup(sqlite: Sqlite.Database, filename: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filename}.${stamp}.bak`
  sqlite.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
  log(`Backed up database to ${backupPath}`)
  pruneBackups(filename)
}

function main(): void {
  // Load .env locally; in production Coolify injects env vars into the container.
  if (process.env.NODE_ENV !== 'production') {
    config()
  }

  const filename = process.env.SQLITE_PATH
  if (!filename) {
    throw new Error('SQLITE_PATH is not set')
  }

  // A missing file is a fresh database: nothing to back up, migrations create everything.
  const isFreshDatabase = !existsSync(filename)
  const sqlite = new Sqlite(filename)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')

    if (isFreshDatabase) {
      log(`No existing database at ${filename}; creating it from migrations.`)
    } else {
      backup(sqlite, filename)
    }

    migrate(drizzle(sqlite, { schema }), { migrationsFolder })
    log('Migrations applied successfully.')
  } finally {
    sqlite.close()
  }
}

try {
  main()
  process.exit(0)
} catch (error) {
  console.error('[migrate] Migration failed:', error)
  process.exit(1)
}
