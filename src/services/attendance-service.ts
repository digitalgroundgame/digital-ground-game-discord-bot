import {
  GuildScheduledEventStatus,
  StageChannel,
  type Guild,
  type GuildBasedChannel,
  type VoiceState,
} from 'discord.js'
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'

import type { Database } from '../database/index.js'
import { session as sessionTable, userSession as userSessionTable } from '../database/schema.js'

export interface AttendanceEntry {
  id: string
  displayName: string
}

export interface AttendanceDmPayload {
  channelName: string
  meetingSubject?: string
  entries: AttendanceEntry[]
  at: Date
}

export interface AttendanceFinalizedResult {
  userId: string
  guildId: string
  channelId: string
  channelName: string
  meetingSubject?: string
  entries: AttendanceEntry[]
}

export type AttendanceFinalizedListener = (
  result: AttendanceFinalizedResult,
) => void | Promise<void>

/** How long after the leader leaves before the session auto-finalizes. */
export const ATTENDANCE_GRACE_PERIOD_MS = 5 * 60 * 1000

function escapeMarkdownCodeFence(text: string): string {
  return text.replaceAll('```', "'''")
}

/** Plain report text (inside the DM code fence for copy-paste). */
export function formatAttendanceReportText(payload: AttendanceDmPayload): string {
  const channelName = escapeMarkdownCodeFence(payload.channelName)
  const dt = DateTime.fromJSDate(payload.at, { zone: 'utc' })
  const dateStr = dt.toFormat("cccc, LLLL d, yyyy 'at' h:mm a 'UTC'")
  let text = `# Attendance of ${channelName}\nDate: ${dateStr}\n`
  if (payload.meetingSubject) {
    text += `Subject: ${escapeMarkdownCodeFence(payload.meetingSubject)}\n`
  }
  text += '\n'
  if (payload.entries.length === 0) {
    text += '_No attendees._'
  } else {
    text += payload.entries.map((e) => `- ${escapeMarkdownCodeFence(e.displayName)}`).join('\n')
  }
  return text
}

/** Discord DM / message content max length. */
const MESSAGE_CONTENT_MAX = 2000
const CODE_FENCE_OPEN = '```\n'
const CODE_FENCE_CLOSE = '\n```'

/**
 * DM body: report wrapped in a ``` code block so Discord shows the one-click copy control.
 */
export function formatAttendanceDmContent(payload: AttendanceDmPayload): string {
  let report = formatAttendanceReportText(payload)
  const maxInner = MESSAGE_CONTENT_MAX - CODE_FENCE_OPEN.length - CODE_FENCE_CLOSE.length
  if (report.length > maxInner) {
    report = `${report.slice(0, maxInner - 24)}\n\n(truncated)`
  }
  return `${CODE_FENCE_OPEN}${report}${CODE_FENCE_CLOSE}`
}

/**
 * Active scheduled event linked to this voice/stage channel, else stage topic when `channel` is a
 * stage with a topic. Uses `voiceChannelId` so scheduled events still resolve if the channel was
 * deleted before the DM is sent (e.g. end of `/attendance-track`).
 */
export async function resolveVoiceChannelMeetingSubject(
  guild: Guild,
  voiceChannelId: string,
  channel?: GuildBasedChannel | null,
): Promise<string | undefined> {
  try {
    const events = await guild.scheduledEvents.fetch()
    const active = [...events.values()].find(
      (e) => e.channelId === voiceChannelId && e.status === GuildScheduledEventStatus.Active,
    )
    if (active) return active.name
  } catch {
    // Missing permissions or API error — fall through to stage topic
  }
  if (channel instanceof StageChannel && channel.topic) {
    return channel.topic
  }
  return undefined
}

/**
 * Tracks VC attendance for `/attendance-track`, persisting `session` and `user_session` rows.
 * State lives entirely in the database — an "active" session is one whose `end_time` is NULL.
 *
 * Finalization is symmetrical: triggered by `/attendance-stop`, or by the leader leaving and not
 * rejoining the tracked channel within {@link ATTENDANCE_GRACE_PERIOD_MS}. `leader_left_at` is
 * persisted so grace periods survive bot restarts (see {@link reconcileOnStartup}).
 *
 * Each enter/leave produces one `user_session` row, so a user can have multiple non-overlapping
 * intervals per `session`.
 */
export class AttendanceService {
  /** Pending grace-period timers, keyed by session id. */
  private readonly graceTimers = new Map<number, NodeJS.Timeout>()
  private readonly finalizedListeners: AttendanceFinalizedListener[] = []
  private readonly guildId: string

  constructor(private readonly db: Database) {
    this.guildId = process.env.DISCORD_GUILD_ID
  }

  onFinalized(listener: AttendanceFinalizedListener): void {
    this.finalizedListeners.push(listener)
  }

  /**
   * Resume grace-period timers for sessions that were active at last shutdown. Sessions whose
   * grace period has already elapsed are finalized immediately.
   */
  async reconcileOnStartup(): Promise<void> {
    const rows = await this.db
      .select({
        id: sessionTable.id,
        leaderLeftAt: sessionTable.leaderLeftAt,
      })
      .from(sessionTable)
      .where(and(isNull(sessionTable.endTime), isNotNull(sessionTable.leaderLeftAt)))

    const now = Date.now()
    for (const row of rows) {
      if (!row.leaderLeftAt) continue
      const elapsed = now - row.leaderLeftAt.getTime()
      const remaining = ATTENDANCE_GRACE_PERIOD_MS - elapsed
      if (remaining <= 0) {
        await this.finalizeAndEmit(row.id)
      } else {
        this.scheduleGraceTimer(row.id, remaining)
      }
    }
  }

  /**
   * Start tracking in the user's current voice channel.
   * `initialMembers` should include everyone in that channel at invocation (e.g. voiceChannel.members).
   */
  async startTracking(
    userId: string,
    channelId: string,
    channelName: string,
    initialMembers: Array<{ id: string; displayName: string }>,
    meetingSubject?: string,
  ): Promise<boolean> {
    if (await this.isTracking(userId)) {
      return false
    }

    const [row] = await this.db
      .insert(sessionTable)
      .values({ sessionLeader: userId, channelId, channelName, meetingSubject })
      .returning({ id: sessionTable.id })
    if (!row) {
      return false
    }

    if (initialMembers.length > 0) {
      await this.db.insert(userSessionTable).values(
        initialMembers.map((m) => ({
          sessionId: row.id,
          userId: m.id,
          displayName: m.displayName,
        })),
      )
    }
    return true
  }

  /**
   * On voice state change: open a `user_session` for joins into a tracked channel, close any open
   * `user_session` for leaves out of a tracked channel. If the tracker leaves their tracked
   * channel, mark `leader_left_at` and schedule the grace-period timer. If the tracker rejoins,
   * clear `leader_left_at` and cancel the timer.
   */
  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const memberId = newState.member?.id ?? oldState.member?.id
    if (!memberId) return

    const oldChannelId = oldState.channelId ?? null
    const newChannelId = newState.channelId ?? null
    if (oldChannelId === newChannelId) return

    const displayName =
      newState.member?.displayName ??
      oldState.member?.displayName ??
      newState.member?.user?.username ??
      oldState.member?.user?.username ??
      'Unknown'

    const trackerSession = await this.findActiveSessionByLeader(memberId)

    // Joined / moved into a tracked channel: open a user_session.
    if (newChannelId !== null) {
      const sessions = await this.findActiveSessionsByChannel(newChannelId)
      for (const s of sessions) {
        await this.db
          .insert(userSessionTable)
          .values({ sessionId: s.id, userId: memberId, displayName })
      }
    }

    // Left / moved out of a tracked channel: close any open user_session for this user.
    if (oldChannelId !== null) {
      const sessions = await this.findActiveSessionsByChannel(oldChannelId)
      for (const s of sessions) {
        await this.closeOpenUserSessions(s.id, memberId)
      }
    }

    // Leader transitions for their own tracked channel.
    if (trackerSession) {
      const leftTracked =
        oldChannelId === trackerSession.channelId && newChannelId !== trackerSession.channelId
      const rejoinedTracked =
        newChannelId === trackerSession.channelId && oldChannelId !== trackerSession.channelId
      if (leftTracked) {
        await this.db
          .update(sessionTable)
          .set({ leaderLeftAt: new Date() })
          .where(eq(sessionTable.id, trackerSession.id))
        this.scheduleGraceTimer(trackerSession.id, ATTENDANCE_GRACE_PERIOD_MS)
      } else if (rejoinedTracked) {
        await this.db
          .update(sessionTable)
          .set({ leaderLeftAt: null })
          .where(eq(sessionTable.id, trackerSession.id))
        this.cancelGraceTimer(trackerSession.id)
      }
    }
  }

  async isTracking(userId: string): Promise<boolean> {
    const session = await this.findActiveSessionByLeader(userId)
    return session !== null
  }

  /** Explicit stop, e.g. from `/attendance-stop`. Returns true if a session was finalized. */
  async stopTracking(userId: string): Promise<boolean> {
    const session = await this.findActiveSessionByLeader(userId)
    if (!session) return false
    await this.finalizeAndEmit(session.id)
    return true
  }

  private scheduleGraceTimer(sessionId: number, delayMs: number): void {
    this.cancelGraceTimer(sessionId)
    const timer = setTimeout(() => {
      this.graceTimers.delete(sessionId)
      void this.finalizeAndEmit(sessionId)
    }, delayMs)
    // Don't keep the process alive solely for this timer.
    timer.unref?.()
    this.graceTimers.set(sessionId, timer)
  }

  private cancelGraceTimer(sessionId: number): void {
    const timer = this.graceTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.graceTimers.delete(sessionId)
    }
  }

  private async findActiveSessionByLeader(userId: string): Promise<{
    id: number
    channelId: string
    channelName: string
  } | null> {
    const [row] = await this.db
      .select({
        id: sessionTable.id,
        channelId: sessionTable.channelId,
        channelName: sessionTable.channelName,
      })
      .from(sessionTable)
      .where(and(eq(sessionTable.sessionLeader, userId), isNull(sessionTable.endTime)))
      .limit(1)
    return row ?? null
  }

  private async findActiveSessionsByChannel(
    channelId: string,
  ): Promise<Array<{ id: number; channelId: string }>> {
    return this.db
      .select({ id: sessionTable.id, channelId: sessionTable.channelId })
      .from(sessionTable)
      .where(and(eq(sessionTable.channelId, channelId), isNull(sessionTable.endTime)))
  }

  /**
   * Cumulative roster for `session_id`: one entry per distinct user, using the display_name from
   * that user's most recent `user_session` row.
   */
  private async getCumulativeRoster(sessionId: number): Promise<AttendanceEntry[]> {
    const rows = await this.db
      .selectDistinctOn([userSessionTable.userId], {
        userId: userSessionTable.userId,
        displayName: userSessionTable.displayName,
      })
      .from(userSessionTable)
      .where(eq(userSessionTable.sessionId, sessionId))
      .orderBy(userSessionTable.userId, desc(userSessionTable.startTime))
    return rows.map((r) => ({ id: r.userId, displayName: r.displayName }))
  }

  private async closeOpenUserSessions(sessionId: number, userId: string): Promise<void> {
    await this.db
      .update(userSessionTable)
      .set({
        endTime: sql`now()`,
        durationSeconds: sql`floor(extract(epoch from (now() - ${userSessionTable.startTime})))::int`,
      })
      .where(
        and(
          eq(userSessionTable.sessionId, sessionId),
          eq(userSessionTable.userId, userId),
          isNull(userSessionTable.endTime),
        ),
      )
  }

  private async finalizeAndEmit(sessionId: number): Promise<void> {
    this.cancelGraceTimer(sessionId)

    const [session] = await this.db
      .select({
        id: sessionTable.id,
        sessionLeader: sessionTable.sessionLeader,
        channelId: sessionTable.channelId,
        channelName: sessionTable.channelName,
        meetingSubject: sessionTable.meetingSubject,
        endTime: sessionTable.endTime,
      })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
    // Bail if already finalized (e.g. timer + stop command race).
    if (!session?.endTime) return

    const entries = await this.getCumulativeRoster(sessionId)
    const now = new Date()
    await this.db
      .update(userSessionTable)
      .set({
        endTime: now,
        durationSeconds: sql`floor(extract(epoch from (${now.toISOString()}::timestamptz - ${userSessionTable.startTime})))::int`,
      })
      .where(and(eq(userSessionTable.sessionId, sessionId), isNull(userSessionTable.endTime)))
    await this.db
      .update(sessionTable)
      .set({ endTime: now, leaderLeftAt: null })
      .where(and(eq(sessionTable.id, sessionId), isNull(sessionTable.endTime)))

    const result: AttendanceFinalizedResult = {
      userId: session.sessionLeader,
      guildId: this.guildId,
      channelId: session.channelId,
      channelName: session.channelName,
      meetingSubject: session.meetingSubject ?? undefined,
      entries,
    }
    for (const listener of this.finalizedListeners) {
      try {
        await listener(result)
      } catch {
        // Listeners must own their own error reporting.
      }
    }
  }
}
