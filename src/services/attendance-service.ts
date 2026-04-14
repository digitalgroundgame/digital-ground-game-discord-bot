import {
  GuildScheduledEventStatus,
  StageChannel,
  type Guild,
  type GuildBasedChannel,
  type VoiceState,
} from 'discord.js'
import { DateTime } from 'luxon'

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

interface AttendanceSession {
  channelId: string
  guildId: string
  channelName: string
  /** Cumulative: everyone in the call when tracking started, plus anyone who joins later. */
  members: Map<string, string>
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
  ): boolean {
    if (this.sessions.has(userId)) {
      return false
    }
    const members = new Map<string, string>()
    for (const m of initialMembers) {
      members.set(m.id, m.displayName)
    }
    this.sessions.set(userId, {
      channelId,
      guildId,
      channelName,
      members,
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
    entries: AttendanceEntry[]
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
        entries,
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
