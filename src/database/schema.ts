import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** External account providers a Discord user can link. Add new services here. */
export const ACCOUNT_PROVIDERS = ['google', 'github'] as const
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

/** Where an issue claim made through `/give-issue` has got to. */
export const ISSUE_CLAIM_STATES = ['claimed', 'completed', 'expired'] as const
export type IssueClaimState = (typeof ISSUE_CLAIM_STATES)[number]

/**
 * An issue a member claimed through `/give-issue`, recorded at the moment the
 * bot assigned them on GitHub.
 *
 * This is the record that makes a later kudos payout attributable: GitHub
 * knows who is assigned, but only this table knows which Discord member asked
 * for it and which draw it came from. `githubLogin` is denormalized from
 * `linked_account` on purpose — a member may relink a different username
 * later, and the claim should still name the account that was actually
 * assigned.
 */
export const issueClaim = sqliteTable(
  'issue_claim',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    discordUserId: text('discord_user_id')
      .notNull()
      .references(() => user.discordUserId, { onDelete: 'cascade' }),
    githubLogin: text('github_login').notNull(),
    /** `owner/name`, as GitHub spells it. */
    repo: text('repo').notNull(),
    issueNumber: integer('issue_number').notNull(),
    /** True when this issue came from the wildcard slot, which prices the bounty. */
    wildcard: integer('wildcard', { mode: 'boolean' }).notNull().default(false),
    state: text('state', { enum: ISSUE_CLAIM_STATES }).notNull().default('claimed'),
    claimedAt: integer('claimed_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    /** Set when the payout job settles the claim, either paid or expired. */
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  },
  (t) => [
    // One live claim per issue. Re-claiming after an expiry is a new row, so
    // this is deliberately not unique on (repo, issueNumber) alone.
    uniqueIndex('issue_claim_repo_issue_state_uq').on(t.repo, t.issueNumber, t.state),
    // The payout job's read path: every unresolved claim, oldest first.
    index('issue_claim_state_claimed_at_idx').on(t.state, t.claimedAt),
  ],
)

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type LinkedAccount = typeof linkedAccount.$inferSelect
export type NewLinkedAccount = typeof linkedAccount.$inferInsert
export type ContentOverride = typeof contentOverride.$inferSelect
export type IssueClaim = typeof issueClaim.$inferSelect
export type NewIssueClaim = typeof issueClaim.$inferInsert
