import * as chrono from 'chrono-node'
import { type ChatInputCommandInteraction, type PermissionsString } from 'discord.js'
import { RateLimiter } from 'discord.js-rate-limiter'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

const FORMATS = [
  { style: 't', label: 'Short Time' },
  { style: 'f', label: 'Short Date/Time' },
  { style: 'F', label: 'Long Date/Time' },
  { style: 'R', label: 'Relative' },
]

export class TimestampCommand implements Command {
  public names = [Lang.getRef('chatCommands.timestamp', Language.Default)]
  public cooldown = new RateLimiter(1, 5000)
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
    const input = intr.options.getString(Lang.getRef('arguments.time', Language.Default), true)

    const parsed = chrono.parseDate(input)

    if (!parsed) {
      await InteractionUtils.send(
        intr,
        `Could not parse a date/time from: **${input}**\n\nTry something like:\n- \`3 hours from now\`\n- \`tomorrow at 2pm EST\`\n- \`next friday at noon\`\n- \`December 25, 2026 8:00 PM\``,
        true,
      )
      return
    }

    const unix = Math.floor(parsed.getTime() / 1000)

    const preview = FORMATS.map((f) => {
      const formattedTime = `<t:${unix}:${f.style}>`
      // Display how the timestamp will format, and then give a copyable timestamp in a codeblock
      return `${formattedTime}\n\`\`\`\n${formattedTime}\n\`\`\``
    }).join('\n')

    await InteractionUtils.send(intr, { content: `You entered: **${input}**\n\n${preview}` }, true)
  }
}
