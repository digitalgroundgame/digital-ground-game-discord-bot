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

export const TRACKER_TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const
export type TrackerTaskStatus = (typeof TRACKER_TASK_STATUSES)[number]
export const TRACKER_PROJECT_STATUSES = ['active', 'archived'] as const
export type TrackerProjectStatus = (typeof TRACKER_PROJECT_STATUSES)[number]

/** Small, guild-scoped project tracker ported from ProgressTrackerFromJocular. */
export const trackerProject = sqliteTable(
  'tracker_project',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ownerId: text('owner_id').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex('tracker_project_guild_name_uq').on(t.guildId, t.name)],
)

export const trackerMilestone = sqliteTable(
  'tracker_milestone',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    guildId: text('guild_id').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => trackerProject.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex('tracker_milestone_project_name_uq').on(t.projectId, t.name)],
)

export const trackerTask = sqliteTable('tracker_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  guildId: text('guild_id').notNull(),
  projectId: integer('project_id')
    .notNull()
    .references(() => trackerProject.id, { onDelete: 'cascade' }),
  milestoneId: integer('milestone_id')
    .notNull()
    .references(() => trackerMilestone.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status', { enum: TRACKER_TASK_STATUSES }).notNull().default('todo'),
  assigneeId: text('assignee_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type LinkedAccount = typeof linkedAccount.$inferSelect
export type NewLinkedAccount = typeof linkedAccount.$inferInsert
export type ContentOverride = typeof contentOverride.$inferSelect
export type TrackerProject = typeof trackerProject.$inferSelect
export type TrackerMilestone = typeof trackerMilestone.$inferSelect
export type TrackerTask = typeof trackerTask.$inferSelect
