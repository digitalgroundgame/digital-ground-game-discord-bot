import Sqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { Rules } from '../../src/constants/rules.js'
import * as schema from '../../src/database/schema.js'
import { RuleService } from '../../src/services/rule-service.js'

/** In-memory database with the rule table (mirrors `npm run db:push`). */
function createTestDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  const sqlite = new Sqlite(':memory:')
  sqlite.exec(`
    CREATE TABLE rule (
      id integer PRIMARY KEY AUTOINCREMENT,
      position integer NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      updated_by text,
      created_at integer NOT NULL DEFAULT (unixepoch()),
      updated_at integer NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX rule_position_uq ON rule (position);
  `)
  return drizzle(sqlite, { schema })
}

const DEFAULT_COUNT = Rules.ServerRules.length

describe('RuleService', () => {
  let service: RuleService

  beforeEach(async () => {
    service = new RuleService(createTestDatabase())
    await service.seedDefaultsIfEmpty()
  })

  it('seeds the hardcoded defaults once', async () => {
    const rules = await service.getRules()
    expect(rules).toHaveLength(DEFAULT_COUNT)
    expect(rules[0]?.position).toBe(1)
    expect(rules[0]?.title).toBe(Rules.ServerRules[0]?.title)

    // Idempotent: a second seed must not duplicate.
    await service.seedDefaultsIfEmpty()
    expect(await service.getRules()).toHaveLength(DEFAULT_COUNT)
  })

  it('serves the hardcoded defaults read-only without a database', async () => {
    const detached = new RuleService()

    expect(detached.isPersistent).toBe(false)
    expect(service.isPersistent).toBe(true)

    const rules = await detached.getRules()
    expect(rules).toHaveLength(DEFAULT_COUNT)
    expect(rules[1]?.title).toBe(Rules.ServerRules[1]?.title)

    await expect(detached.updateRule(1, { title: 'x', description: '' }, 'u')).rejects.toThrow(
      'not configured',
    )
    await expect(detached.addRule({ title: 'x', description: '' }, 'u')).rejects.toThrow(
      'not configured',
    )
    await expect(detached.removeRule(1, 'u')).rejects.toThrow('not configured')
  })

  it('updates a rule in place', async () => {
    const updated = await service.updateRule(
      2,
      { title: 'New Title', description: 'New description.' },
      'user-1',
    )

    expect(updated).toBe(true)
    const rule = await service.getRule(2)
    expect(rule).toEqual({ position: 2, title: 'New Title', description: 'New description.' })

    // Other rules untouched.
    expect((await service.getRule(1))?.title).toBe(Rules.ServerRules[0]?.title)
  })

  it('returns false when updating or removing a missing position', async () => {
    expect(await service.updateRule(99, { title: 'x', description: '' }, 'u')).toBe(false)
    expect(await service.removeRule(99, 'u')).toBe(false)
  })

  it('appends new rules at the end', async () => {
    const added = await service.addRule({ title: 'Rule N', description: 'Desc' }, 'user-1')

    expect(added.position).toBe(DEFAULT_COUNT + 1)
    const rules = await service.getRules()
    expect(rules).toHaveLength(DEFAULT_COUNT + 1)
    expect(rules.at(-1)).toEqual({
      position: DEFAULT_COUNT + 1,
      title: 'Rule N',
      description: 'Desc',
    })
  })

  it('removes a rule and renumbers the rest contiguously', async () => {
    const before = await service.getRules()
    const removedTitle = before[2]?.title // position 3
    const shiftedTitle = before[3]?.title // position 4 → becomes 3

    expect(await service.removeRule(3, 'user-1')).toBe(true)

    const after = await service.getRules()
    expect(after).toHaveLength(DEFAULT_COUNT - 1)
    expect(after.map((rule) => rule.position)).toEqual(
      Array.from({ length: DEFAULT_COUNT - 1 }, (_, index) => index + 1),
    )
    expect(after.some((rule) => rule.title === removedTitle)).toBe(false)
    expect((await service.getRule(3))?.title).toBe(shiftedTitle)
  })

  it('can remove down to zero rules', async () => {
    for (let i = DEFAULT_COUNT; i >= 1; i--) {
      expect(await service.removeRule(1, 'user-1')).toBe(true)
    }
    expect(await service.getRules()).toHaveLength(0)
  })
})
