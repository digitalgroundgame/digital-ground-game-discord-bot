import { describe, expect, it } from 'vitest'

import { chunkRoleLines, formatRoleLines } from '../../src/commands/chat/roles-command.js'

describe('roles command formatting', () => {
  it('omits managed roles and sorts by Discord hierarchy', () => {
    const roles = [
      { id: '1', name: 'Low', position: 1, managed: false },
      { id: '2', name: 'Bot', position: 3, managed: true },
      { id: '3', name: 'Admin', position: 5, managed: false },
      { id: 'guild-a', name: '@everyone', position: 0, managed: false, guild: { id: 'guild-a' } },
    ]

    expect(formatRoleLines(roles as never)).toEqual(['**Admin** - ID: `3`', '**Low** - ID: `1`'])
  })

  it('keeps role output under the requested message size', () => {
    const chunks = chunkRoleLines(['one', 'two', 'three'], 7)

    expect(chunks).toEqual(['one\ntwo', 'three'])
    expect(chunks.every((chunk) => chunk.length <= 7)).toBe(true)
  })
})
