import { type ChatInputCommandInteraction, type PermissionsString, type Role } from 'discord.js'

import { Language } from '../../models/enum-helpers/index.js'
import { type EventData } from '../../models/internal-models.js'
import { Lang } from '../../services/index.js'
import { InteractionUtils } from '../../utils/index.js'
import { type Command, CommandDeferType } from '../index.js'

const DISCORD_MESSAGE_LIMIT = 2000
const ROLE_OUTPUT_LIMIT = DISCORD_MESSAGE_LIMIT - 100

export function formatRoleLines(roles: Iterable<Role>): string[] {
  return Array.from(roles)
    .filter((role) => !role.managed && role.id !== role.guild?.id)
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
    .map((role) => `**${role.name}** - ID: \`${role.id}\``)
}

export function chunkRoleLines(lines: string[], maxLength = ROLE_OUTPUT_LIMIT): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n${line}` : line
  }
  if (current) chunks.push(current)
  return chunks
}

export class RolesCommand implements Command {
  public names = [Lang.getRef('chatCommands.roles', Language.Default)]
  public deferType = CommandDeferType.HIDDEN
  public requireClientPerms: PermissionsString[] = []

  public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
    if (!intr.guild) {
      await InteractionUtils.send(intr, 'This command can only be used in a server.', true)
      return
    }

    const roles = await intr.guild.roles.fetch()
    const chunks = chunkRoleLines(formatRoleLines(roles?.values() ?? []))
    if (!chunks.length) {
      await InteractionUtils.send(intr, 'This server has no inspectable roles.', true)
      return
    }

    await InteractionUtils.send(intr, `**${intr.guild.name} - Roles**\n${chunks[0]}`, true)
    for (const chunk of chunks.slice(1)) await InteractionUtils.send(intr, chunk, true)
  }
}
