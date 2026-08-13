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
 * An access grant recorded when `/grant-access` adds a linked account to a
 * team's resource (for Google, a Workspace Group). One row per (account, team);
 * re-granting the same team upserts. Cascades when the linked account is removed.
 *
 * This is the bot's own record of what it granted — it does not reflect
 * memberships created outside the bot or changed directly in the provider.
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
export type ContentOverride = typeof contentOverride.$inferSelect
