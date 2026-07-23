import { type ActivityType, Client, type ClientOptions, type Presence } from 'discord.js'

import { type GetUserResponse } from '../models/cluster-api/index.js'
import { RoleDiscoveryService, type UserService } from '../services/index.js'
import { ClientUtils } from '../utils/index.js'

export class CustomClient extends Client {
  /** Set by the bot process (see `start-bot.ts`) to enable DB-backed lookups. */
  public userService?: UserService

  constructor(clientOptions: ClientOptions) {
    super(clientOptions)
  }

  /**
   * Resolve a member's basic identity and active pre-defined roles, or null when
   * the guild is not on this shard or the user is not a member. Runs in the bot
   * process so it can reuse {@link RoleDiscoveryService}; the manager reaches it
   * via `broadcastEval`. The return value must stay JSON-serializable for IPC.
   */
  public async getUserInfo(guildId: string, userId: string): Promise<GetUserResponse | null> {
    const guild = this.guilds.cache.get(guildId)
    if (!guild) return null

    const member = await ClientUtils.findMember(guild, userId)
    if (!member) return null

    const linkedAccounts = (await this.userService?.listLinkedAccounts(member.id)) ?? []

    return {
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      roles: new RoleDiscoveryService().getActiveRoles(member),
      access: linkedAccounts.map((account) => ({
        provider: account.provider,
        username: account.externalId,
        displayName: account.displayName,
        linkedAt: account.linkedAt.toISOString(),
      })),
    }
  }

  public setPresence(
    type: Exclude<ActivityType, ActivityType.Custom>,
    name: string,
    url: string,
  ): Presence {
    if (!this.user) {
      throw new Error('Client user is not available.')
    }
    return this.user.setPresence({
      activities: [
        {
          type,
          name,
          url,
        },
      ],
    })
  }
}
