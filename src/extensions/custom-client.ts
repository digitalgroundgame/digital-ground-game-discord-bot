import { type ActivityType, Client, type ClientOptions, type Presence } from 'discord.js'

import { type GetUserResponse } from '../models/cluster-api/index.js'
import { UserService } from '../services/index.js'

export class CustomClient extends Client {
  /** Set by the bot process (see `start-bot.ts`) to enable DB-backed lookups. */
  public userService?: UserService

  constructor(clientOptions: ClientOptions) {
    super(clientOptions)
  }

  /**
   * Resolve a member's basic identity and active pre-defined roles, or null when
   * the guild is not on this shard or the user is not a member. Runs in the bot
   * process so it can reuse {@link UserService}; the manager reaches it via
   * `broadcastEval`. The return value must stay JSON-serializable for IPC.
   */
  public async getUserInfo(guildId: string, userId: string): Promise<GetUserResponse | null> {
    const guild = this.guilds.cache.get(guildId)
    if (!guild) return null

    // Fetch by id directly rather than via `ClientUtils.findMember`, whose
    // display-name fallback is meant for human command input, not API ids.
    const member = await guild.members.fetch(userId).catch(() => null)
    if (!member) return null

    const linkedAccounts = (await this.userService?.listLinkedAccounts(member.id)) ?? []
    const grants = (await this.userService?.listAccessGrants(member.id)) ?? []

    // Group grants under the linked account they belong to.
    const grantsByAccount = new Map<number, typeof grants>()
    for (const grant of grants) {
      const forAccount = grantsByAccount.get(grant.linkedAccountId) ?? []
      forAccount.push(grant)
      grantsByAccount.set(grant.linkedAccountId, forAccount)
    }

    return {
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName,
      // Guild avatar first, then global account avatar, else null. Mirrors
      // in-house-mgmt's build_avatar_url; nullish (not the default silhouette)
      // so the consumer can render its own initials fallback.
      avatarUrl: member.avatarURL() ?? member.user.avatarURL() ?? null,
      joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      roles: UserService.getActiveRoles(member),
      access: linkedAccounts.map((account) => ({
        provider: account.provider,
        username: account.externalId,
        displayName: account.displayName,
        linkedAt: account.linkedAt.toISOString(),
        grants: (grantsByAccount.get(account.id) ?? []).map((grant) => ({
          team: grant.team,
          groupAddress: grant.groupAddress,
          grantedAt: grant.grantedAt.toISOString(),
        })),
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
