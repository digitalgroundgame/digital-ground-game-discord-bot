import { beforeEach, describe, expect, it } from 'vitest'

import { ContentKeys, ManagedContent } from '../../src/constants/managed-content.js'
import { ContentService } from '../../src/services/content-service.js'
import { createTestDatabase } from '../helpers/test-database.js'

const KEY = ContentKeys.WelcomeThread

describe('ContentService', () => {
  let service: ContentService

  beforeEach(() => {
    service = new ContentService(createTestDatabase())
  })

  it('returns registry defaults when no override exists', async () => {
    const values = await service.getContent(KEY)

    expect(values).toEqual(ContentService.getDefaults(KEY))
    expect(values['message']).toContain('Welcome to Digital Ground Game')
    expect(await service.getOverrideMeta(KEY)).toBeUndefined()
  })

  it('returns the override after it is set, with meta', async () => {
    await service.setContent(KEY, { message: 'Custom welcome!' }, 'user-1')

    const values = await service.getContent(KEY)
    expect(values['message']).toBe('Custom welcome!')

    const meta = await service.getOverrideMeta(KEY)
    expect(meta?.updatedBy).toBe('user-1')
    expect(meta?.updatedAt).toBeInstanceOf(Date)
  })

  it('updates in place when a field is set again', async () => {
    await service.setContent(KEY, { message: 'First' }, 'user-1')
    await service.setContent(KEY, { message: 'Second' }, 'user-2')

    const values = await service.getContent(KEY)
    expect(values['message']).toBe('Second')
    expect((await service.getOverrideMeta(KEY))?.updatedBy).toBe('user-2')
  })

  it('reverts to defaults after reset', async () => {
    await service.setContent(KEY, { message: 'Custom welcome!' }, 'user-1')
    await service.resetContent(KEY)

    expect(await service.getContent(KEY)).toEqual(ContentService.getDefaults(KEY))
    expect(await service.getOverrideMeta(KEY)).toBeUndefined()
  })

  it('merges overrides with defaults per field', async () => {
    // Guard for multi-field entries (onboarding/rules slices): overriding one
    // field must not clobber the defaults of the others.
    const multiFieldKey = Object.keys(ManagedContent).find(
      (key) => (ManagedContent[key]?.fields.length ?? 0) > 1,
    )
    if (!multiFieldKey) return // registry has no multi-field entries yet

    const entry = ManagedContent[multiFieldKey]
    const [first, ...rest] = entry?.fields ?? []
    if (!first) return

    await service.setContent(multiFieldKey, { [first.id]: 'Overridden' }, 'user-1')

    const values = await service.getContent(multiFieldKey)
    expect(values[first.id]).toBe('Overridden')
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
    expect(() => ContentService.getDefaults('not-a-key')).toThrow('Unknown managed content key')
  })
})
