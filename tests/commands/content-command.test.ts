/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentCommand } from '../../src/commands/chat/content-command.js'
import { ContentKeys } from '../../src/constants/managed-content.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { ContentService } from '../../src/services/content-service.js'
import { createMockGuildMember } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

/**
 * A ChatInputCommandInteraction stub for /content. The edit modal is
 * stubbed to never be submitted.
 */
function createContentInteraction(subcommand: 'show' | 'edit' | 'reset', key: string): any {
  const member = createMockGuildMember()
  return {
    user: member.user,
    member,
    deferred: false,
    replied: false,
    options: {
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      getString: vi.fn().mockReturnValue(key),
    },
    reply: vi.fn().mockResolvedValue({}),
    deferReply: vi.fn().mockResolvedValue({}),
    followUp: vi.fn().mockResolvedValue({}),
    showModal: vi.fn().mockResolvedValue(undefined),
    awaitModalSubmit: vi.fn().mockRejectedValue(new Error('modal not submitted')),
  }
}

describe('ContentCommand', () => {
  let command: ContentCommand
  const data = new EventData(Language.Default, Language.Default)

  beforeEach(() => {
    command = new ContentCommand(new ContentService(createTestDatabase()))
  })

  it('opens the edit modal for a known key', async () => {
    const intr = createContentInteraction('edit', ContentKeys.WelcomeThread)

    await command.execute(intr, data)

    expect(intr.showModal).toHaveBeenCalledTimes(1)
    expect(intr.reply).not.toHaveBeenCalled()
  })

  it('rejects an unknown key', async () => {
    const intr = createContentInteraction('edit', 'not-a-key')

    await command.execute(intr, data)

    expect(intr.showModal).not.toHaveBeenCalled()
    expect(intr.reply).toHaveBeenCalledTimes(1)
  })

  it('refuses edit and reset without persistence, but still shows defaults', async () => {
    const detachedCommand = new ContentCommand(new ContentService())

    const edit = createContentInteraction('edit', ContentKeys.WelcomeThread)
    await detachedCommand.execute(edit, data)
    expect(edit.showModal).not.toHaveBeenCalled()
    expect(edit.reply).toHaveBeenCalledTimes(1)

    const reset = createContentInteraction('reset', ContentKeys.WelcomeThread)
    await detachedCommand.execute(reset, data)
    expect(reset.deferReply).not.toHaveBeenCalled()
    expect(reset.reply).toHaveBeenCalledTimes(1)

    const show = createContentInteraction('show', ContentKeys.WelcomeThread)
    await detachedCommand.execute(show, data)
    expect(show.deferReply).toHaveBeenCalledTimes(1)
  })
})
