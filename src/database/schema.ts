import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** External account providers a Discord user can link. Add new services here. */
export const ACCOUNT_PROVIDERS = ['google'] as const
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number]

/** A Discord member known to the bot. */
export const user = sqliteTable('user', {
  discordUserId: text('discord_user_id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

/**
 * An external account a Discord user has linked via `/link-account`.
 * One row per (user, provider).
 *
 * - `externalId` is the provider's stable identifier (for Google, the account email).
 * - `email` / `displayName` are nullable — not every provider supplies both.
 */
export const linkedAccount = sqliteTable(
  'linked_account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    discordUserId: text('discord_user_id')
      .notNull()
      .references(() => user.discordUserId, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ACCOUNT_PROVIDERS }).notNull(),
    externalId: text('external_id').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    linkedAt: integer('linked_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    // One account per provider per user; re-linking upserts the same row.
    uniqueIndex('linked_account_user_provider_uq').on(t.discordUserId, t.provider),
    // The same external account cannot be claimed by two Discord users.
    uniqueIndex('linked_account_provider_external_uq').on(t.provider, t.externalId),
  ],
)

/**
 * A linked account's access to a team's resource (for Google, a Workspace Group).
 * One row per (account, team); recording the same team again upserts, moving both
 * timestamps. Cascades when the linked account is removed.
 *
 * Written by `/grant-access` when it adds someone, and by `/backfill-grants` for
 * membership that already existed in the provider — so this is not limited to
 * what the bot did itself. It is still a snapshot: a membership revoked directly
 * in the provider stays recorded until the next backfill.
 */
export const accessGrant = sqliteTable(
  'access_grant',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    linkedAccountId: integer('linked_account_id')
      .notNull()
      .references(() => linkedAccount.id, { onDelete: 'cascade' }),
    // `/grant-access` team shortname (see `config.grantAccess.groups`).
    team: text('team').notNull(),
    // Provider resource the member was added to, resolved at grant time
    // (for Google, the Group email address).
    groupAddress: text('group_address').notNull(),
    grantedAt: integer('granted_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex('access_grant_account_team_uq').on(t.linkedAccountId, t.team)],
)

/**
 * A grant discovered for an external account that no Discord user has linked yet
 * — written by `/backfill-grants`, which reads the real membership of every known
 * provider group. One row per (provider, email, team).
 *
 * These are pre-fills, not grants: when someone links an account whose email
 * matches, {@link accessGrant} rows are materialized from the pending rows so
 * their existing access shows up immediately (see `UserService.linkAccount`).
 * Rows are kept after materialization so a later re-link, or a link by a
 * different Discord user, still picks the membership up.
 */
export const pendingAccessGrant = sqliteTable(
  'pending_access_grant',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    provider: text('provider', { enum: ACCOUNT_PROVIDERS }).notNull(),
    // Provider account address, stored lowercase to match `linked_account.email`.
    email: text('email').notNull(),
    // `/grant-access` team shortname (see `config.grantAccess.groups`).
    team: text('team').notNull(),
    // Provider resource the member belongs to (for Google, the Group email address).
    groupAddress: text('group_address').notNull(),
    // When the backfill last saw this membership in the provider.
    discoveredAt: integer('discovered_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('pending_access_grant_provider_email_team_uq').on(t.provider, t.email, t.team),
  ],
)

/**
 * A runtime override of one field of a managed content entry (see
 * `constants/managed-content.ts`). One row per (key, field); a missing row
 * means the hardcoded default is used.
 */
export const contentOverride = sqliteTable(
  'content_override',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex('content_override_key_field_uq').on(t.key, t.field)],
)

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type LinkedAccount = typeof linkedAccount.$inferSelect
export type NewLinkedAccount = typeof linkedAccount.$inferInsert
export type AccessGrant = typeof accessGrant.$inferSelect
export type NewAccessGrant = typeof accessGrant.$inferInsert
export type PendingAccessGrant = typeof pendingAccessGrant.$inferSelect
export type NewPendingAccessGrant = typeof pendingAccessGrant.$inferInsert
export type ContentOverride = typeof contentOverride.$inferSelect
