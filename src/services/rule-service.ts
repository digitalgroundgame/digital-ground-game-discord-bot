import { asc, eq } from 'drizzle-orm'

import { Logger } from './logger.js'
import { Rules } from '../constants/rules.js'
import { type Database } from '../database/index.js'
import { rule } from '../database/schema.js'

/** A server rule as displayed: 1-based position plus its text. */
export interface RuleRecord {
  position: number
  title: string
  description: string
}

/** The editable text of a rule. */
export interface RuleText {
  title: string
  description: string
}

/**
 * Owns the server rules. Reading is always available — without a database
 * (or on database errors) the hardcoded defaults in `constants/rules.ts`
 * are served. Mutations require a database (`isPersistent`); the table is
 * seeded from the defaults on first start.
 */
export class RuleService {
  constructor(private readonly db?: Database) {}

  /** Whether rules can be edited (a database is configured). */
  public get isPersistent(): boolean {
    return this.db !== undefined
  }

  /** Insert the hardcoded defaults if the table is empty (first run). */
  public async seedDefaultsIfEmpty(): Promise<void> {
    const db = this.requireDb()
    const existing = await db.query.rule.findFirst({ columns: { id: true } })
    if (existing) return

    const now = new Date()
    db.transaction((tx) => {
      Rules.ServerRules.forEach((defaults, index) => {
        tx.insert(rule)
          .values({
            position: index + 1,
            title: defaults.title,
            description: defaults.description,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      })
    })
    Logger.info(`Seeded ${Rules.ServerRules.length} server rules from the hardcoded defaults`)
  }

  /** All rules ordered by position. Falls back to the hardcoded defaults. */
  public async getRules(): Promise<RuleRecord[]> {
    if (!this.db) {
      return this.defaults()
    }
    try {
      const rows = await this.db.query.rule.findMany({ orderBy: [asc(rule.position)] })
      return rows.map((row) => ({
        position: row.position,
        title: row.title,
        description: row.description,
      }))
    } catch (error) {
      Logger.error('Failed to read server rules; falling back to hardcoded defaults', error)
      return this.defaults()
    }
  }

  /** The rule at a 1-based position, or undefined if it doesn't exist. */
  public async getRule(position: number): Promise<RuleRecord | undefined> {
    const rules = await this.getRules()
    return rules.find((record) => record.position === position)
  }

  /** Update a rule's text. Returns false if no rule exists at the position. */
  public async updateRule(position: number, text: RuleText, updatedBy: string): Promise<boolean> {
    const db = this.requireDb()
    const result = db
      .update(rule)
      .set({ title: text.title, description: text.description, updatedBy, updatedAt: new Date() })
      .where(eq(rule.position, position))
      .run()
    if (result.changes > 0) {
      Logger.info(`Rule ${position} updated by ${updatedBy}`)
      return true
    }
    return false
  }

  /** Append a new rule at the end of the list and return it. */
  public async addRule(text: RuleText, updatedBy: string): Promise<RuleRecord> {
    const db = this.requireDb()
    const now = new Date()
    const added = db.transaction((tx) => {
      const rows = tx.select({ position: rule.position }).from(rule).all()
      const position = rows.reduce((max, row) => Math.max(max, row.position), 0) + 1
      tx.insert(rule)
        .values({
          position,
          title: text.title,
          description: text.description,
          updatedBy,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      return { position, title: text.title, description: text.description }
    })
    Logger.info(`Rule ${added.position} added by ${updatedBy}`)
    return added
  }

  /**
   * Remove the rule at a position and renumber the remaining rules to stay
   * contiguous (1..n). Returns false if no rule exists at the position.
   */
  public async removeRule(position: number, removedBy: string): Promise<boolean> {
    const db = this.requireDb()
    const removed = db.transaction((tx) => {
      const result = tx.delete(rule).where(eq(rule.position, position)).run()
      if (result.changes === 0) {
        return false
      }
      // Rewrite positions in ascending order; each row only ever moves down,
      // so the unique index is never transiently violated.
      const remaining = tx.select().from(rule).orderBy(asc(rule.position)).all()
      remaining.forEach((row, index) => {
        const target = index + 1
        if (row.position !== target) {
          tx.update(rule).set({ position: target }).where(eq(rule.id, row.id)).run()
        }
      })
      return true
    })
    if (removed) {
      Logger.info(`Rule ${position} removed by ${removedBy}; remaining rules renumbered`)
    }
    return removed
  }

  private defaults(): RuleRecord[] {
    return Rules.ServerRules.map((defaults, index) => ({
      position: index + 1,
      title: defaults.title,
      description: defaults.description,
    }))
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error('Rule persistence is not configured (no database)')
    }
    return this.db
  }
}
