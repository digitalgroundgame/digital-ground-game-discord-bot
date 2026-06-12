import { beforeEach, describe, expect, it } from 'vitest'

import { ContentKeys, ManagedContent } from '../../src/constants/managed-content.js'
import { ContentService } from '../../src/services/content-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

const KEY = ContentKeys.WelcomeThread

/** Registry defaults via a persistence-less service. */
function getDefaults(key: string): Promise<Record<string, string>> {
  return new ContentService().getContent(key)
}

describe('ContentService', () => {
  let service: ContentService

  beforeEach(() => {
    service = new ContentService(createTestDatabase())
  })

  it('returns registry defaults when no override exists', async () => {
    const { values, meta } = await service.getOverride(KEY)

    expect(values).toEqual(await getDefaults(KEY))
    expect(values['message']).toContain('Welcome to Digital Ground Game')
    expect(meta).toBeUndefined()
  })

  it('returns the override after it is set, with meta', async () => {
    await service.setContent(KEY, { message: 'Custom welcome!' }, 'user-1')

    const { values, meta } = await service.getOverride(KEY)
    expect(values['message']).toBe('Custom welcome!')
    expect(meta?.updatedBy).toBe('user-1')
    expect(meta?.updatedAt).toBeInstanceOf(Date)
  })

  it('updates in place when a field is set again', async () => {
    await service.setContent(KEY, { message: 'First' }, 'user-1')
    await service.setContent(KEY, { message: 'Second' }, 'user-2')

    const { values, meta } = await service.getOverride(KEY)
    expect(values['message']).toBe('Second')
    expect(meta?.updatedBy).toBe('user-2')
  })

  it('reverts to defaults after reset', async () => {
    await service.setContent(KEY, { message: 'Custom welcome!' }, 'user-1')
    await service.resetContent(KEY)

    const { values, meta } = await service.getOverride(KEY)
    expect(values).toEqual(await getDefaults(KEY))
    expect(meta).toBeUndefined()
  })

  it('serves defaults read-only without a database', async () => {
    const detached = new ContentService()

    expect(detached.isPersistent).toBe(false)
    expect(service.isPersistent).toBe(true)
    expect(await detached.getContent(KEY)).toEqual(await getDefaults(KEY))
    await expect(detached.setContent(KEY, { message: 'x' }, 'user-1')).rejects.toThrow(
      'not configured',
    )
    await expect(detached.resetContent(KEY)).rejects.toThrow('not configured')
  })

  it('merges overrides with defaults per field', async () => {
    // Overriding one field of a multi-field entry must not clobber the
    // defaults of the others.
    const multiField = Object.entries(ManagedContent).find(([, entry]) => entry.fields.length > 1)
    expect(multiField, 'registry must contain a multi-field entry').toBeDefined()
    const [key, entry] = multiField!
    const [first, ...rest] = entry.fields
    expect(first).toBeDefined()
    expect(rest.length).toBeGreaterThan(0)

    await service.setContent(key, { [first!.id]: 'Overridden' }, 'user-1')

    const values = await service.getContent(key)
    expect(values[first!.id]).toBe('Overridden')
    for (const field of rest) {
      expect(values[field.id]).toBe(field.default)
    }
  })

  it('rejects unknown keys and unknown fields', async () => {
    await expect(service.getContent('not-a-key')).rejects.toThrow('Unknown managed content key')
    await expect(service.setContent('not-a-key', { message: 'x' }, 'user-1')).rejects.toThrow(
      'Unknown managed content key',
    )
    await expect(service.setContent(KEY, { bogus: 'x' }, 'user-1')).rejects.toThrow(
      'Unknown fields',
    )
    await expect(getDefaults('not-a-key')).rejects.toThrow('Unknown managed content key')
  })
})
