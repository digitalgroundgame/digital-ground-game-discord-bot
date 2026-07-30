import { type GuildMember } from 'discord.js'
import { and, eq, sql } from 'drizzle-orm'

import { type RoleKey, type ServerRole, ServerRoles } from '../constants/index.js'
import { type Database } from '../database/index.js'
import {
  type AccessGrant,
  accessGrant,
  type AccountProvider,
  type LinkedAccount,
  linkedAccount,
  type PendingAccessGrant,
  pendingAccessGrant,
  user,
} from '../database/schema.js'
import { RoleUtils } from '../utils/role-utils.js'
import { Logger } from './logger.js'

/** Fields captured from an external account when it is linked. */
export interface LinkAccountInput {
  externalId: string
  email?: string
  displayName?: string
}

/** A pre-defined role a member was found to actively hold, carrying its config key. */
export type DiscoveredRole = ServerRole & { key: RoleKey }

/**
 * Manages Discord members: the external accounts (Google, etc.) they have linked
 * via the `/link-account` command, and which of the pre-defined server roles they
 * actively hold.
 */
export class UserService {
  constructor(private readonly db: Database) {}

  /**
   * The pre-defined roles (see `config.roles` / `ServerRoles`) `member` actively
   * holds, as a flat list. Stateless — reads only the passed-in member and the role
   * catalog, delegating membership checks to {@link RoleUtils.memberHasConfiguredRole}
   * so the id-first / name-fallback behavior is preserved. Static so callers without
   * a DB-backed instance (e.g. the API's `broadcastEval` path) can still resolve roles.
   */
  public static getActiveRoles(
    member: GuildMember,
    roles: Record<RoleKey, ServerRole> = ServerRoles,
  ): DiscoveredRole[] {
    return (
      (Object.entries(roles) as [RoleKey, ServerRole][])
        .filter(([, role]) => RoleUtils.memberHasConfiguredRole(member, role.id))
        // Report the id of the guild role the match was actually made on:
        // `memberHasConfiguredRole` falls back to matching by configured *name*,
        // where the real role's id differs from the configured one.
        .map(([key, role]) => ({
          key,
          ...role,
          id: RoleUtils.findConfiguredRole(member.guild, role.id)?.id ?? role.id,
        }))
    )
  }

  /**
   * Link (or refresh) an external account for a Discord user. Ensures the
   * `user` row exists, then upserts the `linked_account` row keyed on
   * (discordUserId, provider) so re-linking updates rather than duplicates.
   *
   * Because the upsert keeps the same row id, any `access_grant` rows recorded
   * against it would survive a re-link and be reported under the *new* address.
   * Linking a different external account therefore drops them: the grants
   * belong to the account that was actually added to the provider resource.
   *
   * Any pending grants recorded for the account's email by `/backfill-grants`
   * are materialized into real access grants in the same transaction, so
   * access the member already had in the provider is visible right away.
   */
  public async linkAccount(
    discordUserId: string,
    provider: AccountProvider,
    account: LinkAccountInput,
  ): Promise<void> {
    const now = new Date()
    let materialized = 0
    this.db.transaction((tx) => {
      const existing = tx
        .select({ id: linkedAccount.id, externalId: linkedAccount.externalId })
        .from(linkedAccount)
        .where(
          and(eq(linkedAccount.discordUserId, discordUserId), eq(linkedAccount.provider, provider)),
        )
        .get()

      if (existing && existing.externalId !== account.externalId) {
        tx.delete(accessGrant).where(eq(accessGrant.linkedAccountId, existing.id)).run()
      }

      tx.insert(user)
        .values({ discordUserId, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: user.discordUserId, set: { updatedAt: now } })
        .run()

      const linked = tx
        .insert(linkedAccount)
        .values({
          discordUserId,
          provider,
          externalId: account.externalId,
          email: account.email,
          displayName: account.displayName,
          linkedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [linkedAccount.discordUserId, linkedAccount.provider],
          set: {
            externalId: account.externalId,
            email: account.email,
            displayName: account.displayName,
            linkedAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: linkedAccount.id })
        .get()

      if (!linked) {
        throw new Error(`Failed to upsert ${provider} linked account for ${discordUserId}`)
      }

      materialized = this.materializePendingGrants(tx, linked.id, provider, account.email, now)
    })
    Logger.info(
      `User link: ${discordUserId} → ${provider} (${account.email ?? account.externalId})` +
        (materialized > 0 ? ` — pre-filled ${materialized} backfilled grant(s)` : ''),
    )
  }

  /**
   * Copy every pending grant recorded for `email` into `access_grant` for the
   * freshly linked account. Upserts with the same semantics as
   * {@link recordAccessGrant} — both timestamps move to now — so a materialized
   * grant is indistinguishable from one `/grant-access` recorded.
   *
   * @returns how many pending grants were found for the email.
   */
  private materializePendingGrants(
    tx: Pick<Database, 'select' | 'insert'>,
    linkedAccountId: number,
    provider: AccountProvider,
    email: string | undefined,
    now: Date,
  ): number {
    const normalized = email?.trim().toLowerCase()
    if (!normalized) return 0

    const pending = tx
      .select()
      .from(pendingAccessGrant)
      .where(
        and(eq(pendingAccessGrant.provider, provider), eq(pendingAccessGrant.email, normalized)),
      )
      .all()

    for (const grant of pending) {
      tx.insert(accessGrant)
        .values({
          linkedAccountId,
          team: grant.team,
          groupAddress: grant.groupAddress,
          grantedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [accessGrant.linkedAccountId, accessGrant.team],
          set: { groupAddress: grant.groupAddress, grantedAt: now, updatedAt: now },
        })
        .run()
    }
    return pending.length
  }

  /** Look up a Discord user's linked account for a given provider, if any. */
  public async findLinkedAccount(
    discordUserId: string,
    provider: AccountProvider,
  ): Promise<LinkedAccount | undefined> {
    return this.db.query.linkedAccount.findFirst({
      where: and(
        eq(linkedAccount.discordUserId, discordUserId),
        eq(linkedAccount.provider, provider),
      ),
    })
  }

  /** All external accounts a Discord user has linked, across every provider. */
  public async listLinkedAccounts(discordUserId: string): Promise<LinkedAccount[]> {
    return this.db.query.linkedAccount.findMany({
      where: eq(linkedAccount.discordUserId, discordUserId),
    })
  }

  /**
   * Record that `linkedAccountId` was granted access to `team` (its provider
   * resource is `groupAddress`). Upserts on (account, team) so re-granting the
   * same team refreshes the row rather than duplicating. `grantedAt` is left
   * alone on conflict so it keeps meaning "when access was first granted" —
   * `/grant-access` records a grant even in the already-a-member case.
   */
  public async recordAccessGrant(
    linkedAccountId: number,
    team: string,
    groupAddress: string,
  ): Promise<void> {
    const now = new Date()
    this.db
      .insert(accessGrant)
      .values({ linkedAccountId, team, groupAddress, grantedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [accessGrant.linkedAccountId, accessGrant.team],
        set: { groupAddress, updatedAt: now },
      })
      .run()
  }

  /**
   * Record that `email` already belongs to `team`'s provider resource, for an
   * account nobody has linked yet. Upserts on (provider, email, team) so a
   * re-run of the backfill refreshes the timestamp rather than duplicating.
   */
  public async recordPendingAccessGrant(
    provider: AccountProvider,
    email: string,
    team: string,
    groupAddress: string,
  ): Promise<void> {
    const now = new Date()
    this.db
      .insert(pendingAccessGrant)
      .values({
        provider,
        email: email.trim().toLowerCase(),
        team,
        groupAddress,
        discoveredAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [pendingAccessGrant.provider, pendingAccessGrant.email, pendingAccessGrant.team],
        set: { groupAddress, discoveredAt: now, updatedAt: now },
      })
      .run()
  }

  /** Pending (not yet linked) grants recorded for a provider account address. */
  public async listPendingAccessGrants(
    provider: AccountProvider,
    email: string,
  ): Promise<PendingAccessGrant[]> {
    return this.db.query.pendingAccessGrant.findMany({
      where: and(
        eq(pendingAccessGrant.provider, provider),
        eq(pendingAccessGrant.email, email.trim().toLowerCase()),
      ),
    })
  }

  /**
   * The linked account claiming `email` for `provider`, if any. Used by the
   * backfill to decide between a real grant and a pending pre-fill.
   *
   * Compared case-insensitively in SQL rather than relying on stored addresses
   * being lowercase: `linkable-accounts.ts` normalizes on the way in today, but
   * SQLite's `=` is case-sensitive, so a provider that ever skipped that step
   * would silently stop matching.
   */
  public async findLinkedAccountByEmail(
    provider: AccountProvider,
    email: string,
  ): Promise<LinkedAccount | undefined> {
    return this.db.query.linkedAccount.findFirst({
      where: and(
        eq(linkedAccount.provider, provider),
        eq(sql`lower(${linkedAccount.email})`, email.trim().toLowerCase()),
      ),
    })
  }

  /**
   * Every access grant recorded for a Discord user, across all of their linked
   * accounts. Each row carries `linkedAccountId` so callers can group grants
   * under the account they belong to.
   */
  public async listAccessGrants(discordUserId: string): Promise<AccessGrant[]> {
    return this.db
      .select({
        id: accessGrant.id,
        linkedAccountId: accessGrant.linkedAccountId,
        team: accessGrant.team,
        groupAddress: accessGrant.groupAddress,
        grantedAt: accessGrant.grantedAt,
        updatedAt: accessGrant.updatedAt,
      })
      .from(accessGrant)
      .innerJoin(linkedAccount, eq(accessGrant.linkedAccountId, linkedAccount.id))
      .where(eq(linkedAccount.discordUserId, discordUserId))
      .all()
  }
}
