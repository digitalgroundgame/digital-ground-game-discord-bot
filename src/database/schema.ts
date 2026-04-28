import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core'

export const session = pgTable('session', {
  id: serial('id').primaryKey(),
  sessionLeader: varchar('session_leader', { length: 20 }).notNull(),
  channelId: varchar('channel_id', { length: 20 }).notNull(),
  channelName: varchar('channel_name', { length: 100 }).notNull(),
  meetingSubject: varchar('meeting_subject', { length: 120 }),
  startTime: timestamp('start_time', { withTimezone: true }).notNull().defaultNow(),
  endTime: timestamp('end_time', { withTimezone: true }),
  leaderLeftAt: timestamp('leader_left_at', { withTimezone: true }),
})

export const userSession = pgTable('user_session', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id')
    .notNull()
    .references(() => session.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 20 }).notNull(),
  displayName: varchar('display_name', { length: 32 }).notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull().defaultNow(),
  endTime: timestamp('end_time', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
})

export type Session = typeof session.$inferSelect
export type NewSession = typeof session.$inferInsert
export type UserSession = typeof userSession.$inferSelect
export type NewUserSession = typeof userSession.$inferInsert
