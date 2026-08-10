import { describe, expect, it } from 'vitest'

import { chunkMentionIds } from '../../src/commands/chat/ping-skill-role-command.js'
import { DiscordLimits } from '../../src/constants/index.js'

function snowflake(index: number): string {
  // Realistic 18-19 digit snowflakes, unique per index.
  return `${1515029712915796099n + BigInt(index)}`
}

describe('chunkMentionIds', () => {
  it('returns no chunks for no members', () => {
    expect(chunkMentionIds([])).toEqual([])
  })

  it('keeps a small list in a single chunk, in order', () => {
    const ids = [snowflake(0), snowflake(1), snowflake(2)]
    expect(chunkMentionIds(ids)).toEqual([ids])
  })

  it('preserves every ID exactly once across chunks', () => {
    const ids = Array.from({ length: 500 }, (_, index) => snowflake(index))
    const chunks = chunkMentionIds(ids)
    expect(chunks.flat()).toEqual(ids)
  })

  it('keeps every chunk within the message content length', () => {
    const ids = Array.from({ length: 500 }, (_, index) => snowflake(index))
    for (const chunk of chunkMentionIds(ids)) {
      const content = chunk.map((id) => `<@${id}>`).join(' ')
      expect(content.length).toBeLessThanOrEqual(DiscordLimits.MESSAGE_CONTENT_LENGTH)
    }
  })

  it('caps chunks at the allowed-mentions user limit even when IDs are short', () => {
    // Short IDs would fit hundreds of mentions under the length limit, so
    // this exercises the mention-count bound specifically.
    const ids = Array.from({ length: 250 }, (_, index) => `${index}`)
    const chunks = chunkMentionIds(ids)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(DiscordLimits.MENTIONS_PER_MESSAGE)
    }
    expect(chunks.flat()).toEqual(ids)
  })

  it('accepts any iterable, not just arrays', () => {
    const ids = new Map(Array.from({ length: 3 }, (_, index) => [snowflake(index), index]))
    expect(chunkMentionIds(ids.keys())).toEqual([[...ids.keys()]])
  })
})
