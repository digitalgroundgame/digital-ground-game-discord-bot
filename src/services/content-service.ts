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

/**
 * Resolves managed content (see `constants/managed-content.ts`) to its
 * current values: database overrides where present, registry defaults
 * otherwise. Consumers without a database call the static `getDefaults`.
 */
export class ContentService {
  constructor(private readonly db: Database) {}

  /** Registry defaults for a key, keyed by field id. Throws on unknown key. */
  public static getDefaults(key: string): Record<string, string> {
    const entry = ManagedContent[key]
    if (!entry) {
      throw new Error(`Unknown managed content key: ${key}`)
    }
    return Object.fromEntries(entry.fields.map((field) => [field.id, field.default]))
  }

  /**
   * Current effective values for a key: defaults merged with any overrides.
   * Database errors fall back to defaults (overrides are best-effort by
   * design); an unknown key still throws.
   */
  public async getContent(key: string): Promise<Record<string, string>> {
    const values = ContentService.getDefaults(key)
    try {
      const rows = await this.db.query.contentOverride.findMany({
        where: eq(contentOverride.key, key),
      })
      for (const row of rows) {
        if (row.field in values) {
          values[row.field] = row.value
        }
      }
    } catch (error) {
      Logger.error(`Failed to read content overrides for "${key}"; using defaults`, error)
    }
    return values
  }

  /** Who last overrode this key and when, or undefined if no override exists. */
  public async getOverrideMeta(key: string): Promise<ContentOverrideMeta | undefined> {
    const rows = await this.db.query.contentOverride.findMany({
      where: eq(contentOverride.key, key),
    })
    const latest = rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    return latest ? { updatedBy: latest.updatedBy, updatedAt: latest.updatedAt } : undefined
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
    const defaults = ContentService.getDefaults(key)
    const unknownFields = Object.keys(values).filter((field) => !(field in defaults))
    if (unknownFields.length > 0) {
      throw new Error(`Unknown fields for content key "${key}": ${unknownFields.join(', ')}`)
    }

    const now = new Date()
    this.db.transaction((tx) => {
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
    ContentService.getDefaults(key) // validate key
    await this.db.delete(contentOverride).where(eq(contentOverride.key, key))
    Logger.info(`Content overrides reset: ${key}`)
  }
}
