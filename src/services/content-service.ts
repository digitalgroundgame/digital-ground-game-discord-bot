import { eq } from 'drizzle-orm'

import { Logger } from './logger.js'
import { ManagedContent } from '../constants/managed-content.js'
import { type Database } from '../database/index.js'
import { contentOverride } from '../database/schema.js'

/** Who last overrode a content entry, and when. */
export interface ContentOverrideMeta {
  updatedBy: string
  updatedAt: Date
}

/** A content entry's effective values, plus override metadata if one exists. */
export interface ResolvedContent {
  values: Record<string, string>
  meta?: ContentOverrideMeta
}

/**
 * Resolves managed content (see `constants/managed-content.ts`) to its
 * current values. Content resolution is always available; persistence is
 * optional — without a database (or on database errors) reads return the
 * registry defaults, and writes are rejected (`isPersistent` tells callers
 * whether edits are possible).
 */
export class ContentService {
  constructor(private readonly db?: Database) {}

  /** Whether overrides can be stored (a database is configured). */
  public get isPersistent(): boolean {
    return this.db !== undefined
  }

  /** Registry defaults for a key, keyed by field id. Throws on unknown key. */
  private static defaults(key: string): Record<string, string> {
    const entry = ManagedContent[key]
    if (!entry) {
      throw new Error(`Unknown managed content key: ${key}`)
    }
    return Object.fromEntries(entry.fields.map((field) => [field.id, field.default]))
  }

  /** Current effective values for a key. Throws only on unknown keys. */
  public async getContent(key: string): Promise<Record<string, string>> {
    return (await this.getOverride(key)).values
  }

  /**
   * Current effective values for a key plus override metadata (who/when),
   * `meta` being undefined when the defaults are in effect. Database errors
   * fall back to defaults; an unknown key still throws.
   */
  public async getOverride(key: string): Promise<ResolvedContent> {
    const values = ContentService.defaults(key)
    if (!this.db) {
      return { values }
    }

    try {
      const rows = await this.db.query.contentOverride.findMany({
        where: eq(contentOverride.key, key),
      })
      let meta: ContentOverrideMeta | undefined
      for (const row of rows) {
        if (row.field in values) {
          values[row.field] = row.value
        }
        if (!meta || row.updatedAt > meta.updatedAt) {
          meta = { updatedBy: row.updatedBy, updatedAt: row.updatedAt }
        }
      }
      return { values, meta }
    } catch (error) {
      Logger.error(`Failed to read content overrides for "${key}"; using defaults`, error)
      return { values }
    }
  }

  /**
   * Override one or more fields of a key. Field ids must exist in the
   * registry entry; re-setting a field updates it in place.
   */
  public async setContent(
    key: string,
    values: Record<string, string>,
    updatedBy: string,
  ): Promise<void> {
    const db = this.requireDb()
    const defaults = ContentService.defaults(key)
    const unknownFields = Object.keys(values).filter((field) => !(field in defaults))
    if (unknownFields.length > 0) {
      throw new Error(`Unknown fields for content key "${key}": ${unknownFields.join(', ')}`)
    }

    const now = new Date()
    db.transaction((tx) => {
      for (const [field, value] of Object.entries(values)) {
        tx.insert(contentOverride)
          .values({ key, field, value, updatedBy, updatedAt: now })
          .onConflictDoUpdate({
            target: [contentOverride.key, contentOverride.field],
            set: { value, updatedBy, updatedAt: now },
          })
          .run()
      }
    })
    Logger.info(`Content override saved: ${key} (${Object.keys(values).join(', ')}) by ${updatedBy}`)
  }

  /** Remove all overrides for a key, reverting it to registry defaults. */
  public async resetContent(key: string): Promise<void> {
    const db = this.requireDb()
    ContentService.defaults(key) // validate key
    await db.delete(contentOverride).where(eq(contentOverride.key, key))
    Logger.info(`Content overrides reset: ${key}`)
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error('Content persistence is not configured (no database)')
    }
    return this.db
  }
}
