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

/**
 * A server rule shown by `/rules` and managed at runtime via `/rules-admin`.
 * `position` is the 1-based display number; rows are renumbered to stay
 * contiguous when a rule is removed.
 */
export const rule = sqliteTable(
  'rule',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    // Discord user id of the last editor; null for seeded defaults.
    updatedBy: text('updated_by'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex('rule_position_uq').on(t.position)],
)

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type LinkedAccount = typeof linkedAccount.$inferSelect
export type NewLinkedAccount = typeof linkedAccount.$inferInsert
export type ContentOverride = typeof contentOverride.$inferSelect
export type RuleRow = typeof rule.$inferSelect
