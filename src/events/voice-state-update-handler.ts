import {
  AttachmentBuilder,
  escapeMarkdown,
  type Client,
  type User,
  type VoiceState,
} from 'discord.js'

import { type EventHandler } from './event-handler.js'
import {
  type AttendanceEntry,
  AttendanceService,
  type CrmDisabledReason,
  formatAttendanceDmContent,
  resolveScheduledEvent,
} from '../services/attendance-service.js'
import { type CrmAttendancePayload, type CrmService } from '../services/crm-service.js'
import { Logger } from '../services/logger.js'
import { MessageUtils } from '../utils/message-utils.js'

const CRM_DISABLED_DM_NOTES: Record<CrmDisabledReason, string> = {
  not_authorized:
    "You weren't authorized to record CRM attendance, so this list wasn't synced — keep it for your records.",
  unlinked_discord_id:
    "Your Discord account isn't linked to a CRM user, so this list wasn't synced — keep it for your records.",
  check_failed:
    "The CRM was unreachable when tracking started, so this list wasn't synced — keep it for your records.",
}

export class VoiceStateUpdateHandler implements EventHandler {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly crmService: CrmService,
    private readonly client: Client,
  ) {}

  public async process(oldState: VoiceState, newState: VoiceState): Promise<void> {
    const result = this.attendanceService.handleVoiceStateUpdate(oldState, newState)
    if (!result) return

    const {
      userId,
      guildId,
      channelId,
      channelName,
      sessionId,
      defaultEventName,
      customEventName,
      entries,
      crmDisabledReason,
    } = result
    try {
      const guild = await this.client.guilds.fetch(guildId)
      const [user, scheduledEvent] = await Promise.all([
        this.client.users.fetch(userId),
        resolveScheduledEvent(guild, channelId),
      ])

      //name must be provided
      //default - event name or channel name + date
      //provide arg for custom name
      const eventId = scheduledEvent?.id ?? sessionId
      const displayEventName = customEventName ?? scheduledEvent?.name ?? defaultEventName

      if (crmDisabledReason) {
        await this.sendFallbackDm(
          user,
          channelName,
          displayEventName,
          entries,
          CRM_DISABLED_DM_NOTES[crmDisabledReason],
          null,
        )
        return
      }

      const payload: CrmAttendancePayload = {
        event_id: eventId,
        event_name: displayEventName,
        event_tracker_discord_id: userId,
        participants: entries.map((e) => ({
          discord_id: e.id,
          discord_name: e.displayName,
          status: 'ATTENDED',
        })),
      }

      try {
        const response = await this.crmService.recordAttendance(payload)

        try {
          const sent = await MessageUtils.send(
            user,
            this.formatCrmReportDm(
              displayEventName,
              channelName,
              response.total_received,
              response.unlinked_participants,
            ),
          )
          if (!sent) {
            Logger.warn(
              `Attendance DM could not be delivered to ${userId} (DMs closed?). CRM row still written for event ${eventId}.`,
            )
          }
        } catch (dmError) {
          Logger.warn(
            `CRM row written for event ${eventId} but delivering the success DM threw: ${String(dmError)}`,
          )
        }
      } catch (error) {
        Logger.error('CRM record-attendance failed', error)
        await this.sendFallbackDm(
          user,
          channelName,
          displayEventName,
          entries,
          'Failed to sync attendance to the CRM. The raw payload is below so it can be replayed manually.',
          payload,
        )
      }
    } catch (error) {
      Logger.error('Failed to process voice state update for attendance', error)
    }
  }

  private async sendFallbackDm(
    user: User,
    channelName: string,
    meetingSubject: string | undefined,
    entries: AttendanceEntry[],
    note: string,
    payload: CrmAttendancePayload | null,
  ): Promise<void> {
    await MessageUtils.send(user, `:warning: ${note}`)

    const reportContent = formatAttendanceDmContent({
      channelName,
      meetingSubject,
      entries,
      at: new Date(),
    })

    await MessageUtils.send(user, reportContent)

    if (payload) {
      const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
      const attachment = new AttachmentBuilder(buffer, {
        name: `attendance-${payload.event_id}.json`,
      })
      await MessageUtils.send(user, {
        content: '**Raw CRM payload (for manual replay):**',
        files: [attachment],
      })
    }
  }

  private formatCrmReportDm(
    eventName: string,
    channelName: string,
    total: number,
    unlinked: Array<{ discord_id: string; discord_name: string }>,
  ): string {
    const noneLinked = unlinked.length === total && total > 0
    const plural = total === 1 ? '' : 's'
    const tail = noneLinked
      ? ', but none can be uploaded yet — no CRM contact matches.'
      : '. Go to the CRM to finish the upload into the event.'
    const lines: string[] = [
      '**Attendance staged in CRM** :white_check_mark:',
      `Event: **${escapeMarkdown(eventName)}** (${escapeMarkdown(channelName)})`,
      `All ${total} attendee${plural} recorded${tail}`,
    ]

    if (unlinked.length > 0) {
      lines.push('')
      lines.push(
        `:warning: **Need a CRM contact before they can be uploaded (${unlinked.length}):**`,
      )
      for (const u of unlinked) lines.push(`- ${escapeMarkdown(u.discord_name)}`)
    }

    return lines.join('\n')
  }
}
