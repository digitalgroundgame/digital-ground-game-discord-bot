/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContentCommand } from '../../src/commands/chat/content-command.js'
import { ContentKeys, ruleContentKey } from '../../src/constants/managed-content.js'
import { Rules } from '../../src/constants/rules.js'
import { ServerRoles } from '../../src/constants/server-roles.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { ContentService } from '../../src/services/content-service.js'
import { createMockGuildMember } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

const FIRST_RULE_SLUG = Rules.ServerRules[0]?.slug ?? ''
const RULE_KEY = ruleContentKey(FIRST_RULE_SLUG)

/**
 * A ChatInputCommandInteraction stub for /content with the member holding
 * the given role IDs. The edit modal is stubbed to never be submitted.
 */
function createContentInteraction(
  subcommand: 'edit' | 'reset',
  key: string,
  memberRoleIds: string[],
): any {
  const member = createMockGuildMember({
    roles: { cache: new Map(memberRoleIds.map((id) => [id, { id }])) },
  })
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

describe('ContentCommand per-entry permissions', () => {
  let command: ContentCommand
  const data = new EventData(Language.Default, Language.Default)

  beforeEach(() => {
    command = new ContentCommand(new ContentService(createTestDatabase()))
  })

  it('denies editing a rule to a member without an allowed role', async () => {
    const intr = createContentInteraction('edit', RULE_KEY, [ServerRoles.DIRECTOR.id])

    await command.execute(intr, data)

    expect(intr.showModal).not.toHaveBeenCalled()
    expect(intr.reply).toHaveBeenCalledTimes(1)
    const embed = intr.reply.mock.calls[0]?.[0]?.embeds?.[0]
    expect(embed?.data?.title).toBe('Permission Denied')
    expect(embed?.data?.description).toContain(ServerRoles.ADMIN.name)
  })

  it('denies resetting a rule to a member without an allowed role', async () => {
    const intr = createContentInteraction('reset', RULE_KEY, [ServerRoles.DIRECTOR.id])

    await command.execute(intr, data)

    expect(intr.deferReply).not.toHaveBeenCalled()
    expect(intr.reply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.title).toBe('Permission Denied')
  })

  it('allows editing a rule for a member with the entry role', async () => {
    const intr = createContentInteraction('edit', RULE_KEY, [ServerRoles.ADMIN.id])

    await command.execute(intr, data)

    expect(intr.showModal).toHaveBeenCalledTimes(1)
    expect(intr.reply).not.toHaveBeenCalled()
  })

  it('falls back to the global gate for entries without allowedRoleKeys', async () => {
    // Welcome thread has no per-entry restriction; a DIRECTOR (globally
    // allowed via requireRoles) may edit it even without ADMIN.
    const intr = createContentInteraction('edit', ContentKeys.WelcomeThread, [
      ServerRoles.DIRECTOR.id,
    ])

    await command.execute(intr, data)

    expect(intr.showModal).toHaveBeenCalledTimes(1)
    expect(intr.reply).not.toHaveBeenCalled()
  })
})
