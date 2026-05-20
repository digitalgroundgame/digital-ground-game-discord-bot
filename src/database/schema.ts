import { pgEnum, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core'

/** External account providers a Discord user can link. Add new services here. */
export const accountProvider = pgEnum('account_provider', ['google'])

/** A Discord member known to the bot. */
export const user = pgTable('user', {
  discordUserId: varchar('discord_user_id', { length: 20 }).primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * An external account a Discord user has linked via `/link-account`.
 * One row per (user, provider).
 *
 * - `externalId` is the provider's stable identifier (for Google, the account email).
 * - `email` / `displayName` are nullable — not every provider supplies both.
 */
export const linkedAccount = pgTable(
  'linked_account',
  {
    id: serial('id').primaryKey(),
    discordUserId: varchar('discord_user_id', { length: 20 })
      .notNull()
      .references(() => user.discordUserId, { onDelete: 'cascade' }),
    provider: accountProvider('provider').notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }),
    displayName: varchar('display_name', { length: 255 }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One account per provider per user; re-linking upserts the same row.
    uniqueIndex('linked_account_user_provider_uq').on(t.discordUserId, t.provider),
    // The same external account cannot be claimed by two Discord users.
    uniqueIndex('linked_account_provider_external_uq').on(t.provider, t.externalId),
  ],
)

export type AccountProvider = (typeof accountProvider.enumValues)[number]
export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type LinkedAccount = typeof linkedAccount.$inferSelect
export type NewLinkedAccount = typeof linkedAccount.$inferInsert
