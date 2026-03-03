import type { Collection } from 'discord.js'
import type { GuildMember, PartialGuildMember, Role } from 'discord.js'

/**
 * Context passed to each member-update use case.
 * Shared data is computed once so use cases don't duplicate work.
 */
export interface MemberUpdateContext {
  addedRoles: Collection<string, Role>
  removedRoles: Collection<string, Role>
}

/**
 * A use case that runs when a guild member is updated.
 * Each use case is invoked independently; one failing or bailing early
 * does not affect others.
 */
export interface MemberUpdateUseCase {
  handle(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    context: MemberUpdateContext,
  ): Promise<void>
}
