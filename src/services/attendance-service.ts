import { randomUUID } from 'node:crypto'

import {
  GuildScheduledEventStatus,
  StageChannel,
  type Guild,
  type GuildBasedChannel,
  type VoiceState,
} from 'discord.js'
import { DateTime } from 'luxon'

import { StringUtils } from '../utils/string-utils.js'

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
 * Active scheduled event linked to this voice/stage channel. Returns both id and name so the
 * bot can identify the event when pushing attendance to the CRM.
 */
export async function resolveScheduledEvent(
  guild: Guild,
  voiceChannelId: string,
): Promise<{ id: string; name: string } | null> {
  const cached = [...guild.scheduledEvents.cache.values()].find(
    (e) => e.channelId === voiceChannelId && e.status === GuildScheduledEventStatus.Active,
  )
  if (cached) return { id: cached.id, name: cached.name }
  try {
    const events = await guild.scheduledEvents.fetch()
    const active = [...events.values()].find(
      (e) => e.channelId === voiceChannelId && e.status === GuildScheduledEventStatus.Active,
    )
    if (active) return { id: active.id, name: active.name }
  } catch {
    // swallow: perms/API error — null is the "no linked event" signal
  }
  return null
}

/**
 * Pure derivation: scheduled event name if present, else stage topic when `channel` is a
 * stage with a topic. Use this when the scheduled event was already resolved upstream.
 */
export function meetingSubjectFrom(
  scheduledEvent: { name: string } | null,
  channel: GuildBasedChannel | null,
): string | undefined {
  if (scheduledEvent) return scheduledEvent.name
  if (channel instanceof StageChannel && channel.topic) return channel.topic
  return undefined
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
  const active = await resolveScheduledEvent(guild, voiceChannelId)
  return meetingSubjectFrom(active, channel ?? null)
}

/**
 * Why CRM sync is off for a session. Set at `/attendance-track` invocation when the preflight
 * permission check rejects or errors. Tracking still proceeds; the handler skips the CRM call
 * at session end and tells the user why.
 */
export type CrmDisabledReason = 'not_authorized' | 'unlinked_discord_id' | 'check_failed'

interface AttendanceSession {
  /** Synthetic identifier used as event_id when no Discord scheduled event is linked.
   * Stable for the lifetime of the tracking session so retries / multi-step CRM
   * writes converge on the same StagedEvent row. */
  sessionId: string
  /** Synthetic event name ("<channel name> — <UTC start time>") used when there's
   * no scheduled event AND the tracker didn't provide a custom name. */
  defaultEventName: string
  /** Optional override the tracker passed via the slash-command's name argument.
   * When set, this wins over both the scheduled-event name and the default. */
  customEventName?: string
  channelId: string
  guildId: string
  channelName: string
  /** Cumulative: everyone in the call when tracking started, plus anyone who joins later. */
  members: Map<string, string>
  crmDisabledReason?: CrmDisabledReason
}

/**
 * Tracks VC attendance for `/attendance-track`: seeds with everyone currently in the channel when
 * the command runs; anyone who joins after that is added and never removed when they leave. When
 * the tracker leaves, the session ends and the list is sent by DM.
 */
export class AttendanceService {
  /** Tracker user id -> session for that user's VC */
  private sessions = new Map<string, AttendanceSession>()

  /**
   * Start tracking in the user's current voice channel.
   * `initialMembers` should include everyone in that channel at invocation (e.g. voiceChannel.members).
   */
  startTracking(
    userId: string,
    channelId: string,
    guildId: string,
    channelName: string,
    initialMembers: Array<{ id: string; displayName: string }>,
    customName?: string,
    crmDisabledReason?: CrmDisabledReason,
  ): boolean {
    if (this.sessions.has(userId)) {
      return false
    }
    const members = new Map<string, string>()
    for (const m of initialMembers) {
      members.set(m.id, m.displayName)
    }
    const trimmedCustomName = customName?.trim()
    const startedAt = DateTime.utc()
    const defaultEventName = StringUtils.truncate(
      `${channelName} — ${startedAt.toFormat("LLL d, yyyy h:mm a 'UTC'")}`,
      100,
    )
    this.sessions.set(userId, {
      sessionId: randomUUID(),
      defaultEventName,
      customEventName: trimmedCustomName ? StringUtils.truncate(trimmedCustomName, 100) : undefined,
      channelId,
      guildId,
      channelName,
      members,
      crmDisabledReason,
    })
    return true
  }

  /**
   * On voice state change: if a user joins or moves into a tracked channel, add them to that
   * session’s cumulative roster. If the tracker leaves their tracked channel, finalize and return
   * the roster for the attendance DM.
   */
  handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState,
  ): {
    userId: string
    guildId: string
    channelId: string
    channelName: string
    sessionId: string
    defaultEventName: string
    customEventName?: string
    entries: AttendanceEntry[]
    crmDisabledReason?: CrmDisabledReason
  } | null {
    const memberId = newState.member?.id ?? oldState.member?.id
    if (!memberId) return null

    const oldChannelId = oldState.channelId ?? null
    const newChannelId = newState.channelId ?? null
    const displayName =
      newState.member?.displayName ??
      oldState.member?.displayName ??
      newState.member?.user?.username ??
      oldState.member?.user?.username ??
      'Unknown'

    if (newChannelId !== null && oldChannelId !== newChannelId) {
      for (const session of this.sessions.values()) {
        if (session.channelId !== newChannelId) continue
        session.members.set(memberId, displayName)
      }
    }

    // If this user was a tracker and they left their tracked channel, finalize and return
    const session = this.sessions.get(memberId)
    if (session && oldChannelId === session.channelId && newChannelId !== session.channelId) {
      this.sessions.delete(memberId)
      const entries: AttendanceEntry[] = Array.from(session.members.entries()).map(
        ([id, name]) => ({ id, displayName: name }),
      )
      return {
        userId: memberId,
        guildId: session.guildId,
        channelId: session.channelId,
        channelName: session.channelName,
        sessionId: session.sessionId,
        defaultEventName: session.defaultEventName,
        customEventName: session.customEventName,
        entries,
        crmDisabledReason: session.crmDisabledReason,
      }
    }

    return null
  }

  isTracking(userId: string): boolean {
    return this.sessions.has(userId)
  }

  stopTracking(userId: string): void {
    this.sessions.delete(userId)
  }
}
