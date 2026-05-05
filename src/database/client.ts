import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema>

export function createDatabase(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const pool = new pg.Pool({ connectionString })
  return drizzle(pool, { schema })
}
