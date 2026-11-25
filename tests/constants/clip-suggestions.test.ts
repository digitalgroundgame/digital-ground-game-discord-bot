import { describe, expect, it } from 'vitest'

import {
  ClipSuggestionsAllowedRoleKeys,
  ClipSuggestionsChannelId,
  parseClipSuggestionsConfig,
} from '../../src/constants/clip-suggestions.js'

describe('parseClipSuggestionsConfig', () => {
  it('returns the trimmed channel id and role keys', () => {
    expect(
      parseClipSuggestionsConfig({ channelId: ' 123456789012345678 ', allowedRoleKeys: ['ADMIN'] }),
    ).toEqual({ channelId: '123456789012345678', allowedRoleKeys: ['ADMIN'] })
  })

  it('treats an empty, blank or missing channel id as unset', () => {
    expect(parseClipSuggestionsConfig({ channelId: '' }).channelId).toBeUndefined()
    expect(parseClipSuggestionsConfig({ channelId: '   ' }).channelId).toBeUndefined()
    expect(parseClipSuggestionsConfig({}).channelId).toBeUndefined()
    expect(parseClipSuggestionsConfig(undefined).channelId).toBeUndefined()
  })

  it('lets everyone submit when no role keys are configured', () => {
    expect(parseClipSuggestionsConfig({ allowedRoleKeys: [] }).allowedRoleKeys).toEqual([])
    expect(parseClipSuggestionsConfig({}).allowedRoleKeys).toEqual([])
  })

  it('rejects an unknown role key', () => {
    expect(() => parseClipSuggestionsConfig({ allowedRoleKeys: ['ADMNI'] })).toThrow(
      /config\.clipSuggestions\.allowedRoleKeys contains unknown role keys: ADMNI/,
    )
  })

  it('rejects a numeric channel id', () => {
    expect(() => parseClipSuggestionsConfig({ channelId: 123 })).toThrow(/must be a string/)
  })

  it('loads the checked-in config', () => {
    expect(ClipSuggestionsChannelId === undefined || /^\d+$/.test(ClipSuggestionsChannelId)).toBe(
      true,
    )
    expect(Array.isArray(ClipSuggestionsAllowedRoleKeys)).toBe(true)
  })
})
