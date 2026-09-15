/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

import { RulesAdminCommand } from '../../src/commands/chat/rules-admin-command.js'
import { Language } from '../../src/models/enum-helpers/index.js'
import { EventData } from '../../src/models/internal-models.js'
import { RuleService } from '../../src/services/rule-service.js'
import { createMockGuildMember } from '../helpers/discord-mocks.js'
import { createTestDatabase } from '../helpers/test-database.js'

function createRulesAdminInteraction(subcommand: 'edit' | 'add', ruleNumber?: number): any {
  const member = createMockGuildMember()
  return {
    user: member.user,
    member,
    deferred: false,
    replied: false,
    options: {
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      getInteger: vi.fn().mockReturnValue(ruleNumber ?? null),
    },
    reply: vi.fn().mockResolvedValue({}),
    deferReply: vi.fn().mockResolvedValue({}),
    followUp: vi.fn().mockResolvedValue({}),
    showModal: vi.fn().mockResolvedValue(undefined),
    awaitModalSubmit: vi.fn().mockRejectedValue(new Error('modal not submitted')),
  }
}

function createModalSubmit(intr: any, values: Record<string, string>): any {
  return {
    user: intr.user,
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: vi.fn().mockImplementation((id: string) => values[id] ?? ''),
    },
    reply: vi.fn().mockResolvedValue({}),
    deferReply: vi.fn().mockResolvedValue({}),
    followUp: vi.fn().mockResolvedValue({}),
  }
}

describe('RulesAdminCommand', () => {
  const data = new EventData(Language.Default, Language.Default)

  it('rejects a whitespace-only title without saving', async () => {
    // Discord's required-input check passes whitespace; the command must not.
    const service = new RuleService(createTestDatabase())
    await service.seedDefaultsIfEmpty()
    const command = new RulesAdminCommand(service)
    const originalTitle = (await service.getRule(1))?.title

    const intr = createRulesAdminInteraction('edit', 1)
    const submit = createModalSubmit(intr, { title: '   ', description: 'kept?' })
    intr.awaitModalSubmit.mockResolvedValue(submit)

    await command.execute(intr, data)

    expect(submit.reply).toHaveBeenCalledTimes(1)
    const embed = submit.reply.mock.calls[0]?.[0]?.embeds?.[0]
    expect(embed?.data?.description).toContain('cannot be empty')
    expect((await service.getRule(1))?.title).toBe(originalTitle)
  })

  it('allows an empty description (rule 1 is title-only by design)', async () => {
    const service = new RuleService(createTestDatabase())
    await service.seedDefaultsIfEmpty()
    const command = new RulesAdminCommand(service)

    const intr = createRulesAdminInteraction('edit', 2)
    const submit = createModalSubmit(intr, { title: 'New Title', description: '   ' })
    intr.awaitModalSubmit.mockResolvedValue(submit)

    await command.execute(intr, data)

    const rule = await service.getRule(2)
    expect(rule?.title).toBe('New Title')
    expect(rule?.description).toBe('')
  })
})
