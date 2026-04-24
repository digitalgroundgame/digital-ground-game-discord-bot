import type { GuildScheduledEvent } from 'discord.js'
import {
  GuildScheduledEventRecurrenceRuleFrequency,
  GuildScheduledEventRecurrenceRuleWeekday,
} from 'discord.js'

type RecurrenceRule = NonNullable<GuildScheduledEvent['recurrenceRule']>

const BY_DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

function discordWeekdayToByDay(w: GuildScheduledEventRecurrenceRuleWeekday): string {
  return BY_DAY[w] ?? 'MO'
}

/** RRULE UNTIL in UTC compact form (RFC 5545 DATE-TIME). */
function formatUntilUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** Discord Monday=0…Sunday=6 from a UTC date (getUTCDay Sunday=0…Saturday=6). */
function utcDateToDiscordWeekday(d: Date): GuildScheduledEventRecurrenceRuleWeekday {
  const sun0 = d.getUTCDay()
  return (sun0 === 0 ? 6 : sun0 - 1) as GuildScheduledEventRecurrenceRuleWeekday
}

/**
 * Build one `RRULE:` string for Google Calendar from a Discord guild scheduled event recurrence rule.
 * Returns null if the rule cannot be expressed (caller should fall back to a single-instance event).
 */
export function discordRecurrenceRuleToGoogleRRule(
  rule: RecurrenceRule,
  firstOccurrenceStartUtc: Date,
): string | null {
  const segments: string[] = []
  const interval = Math.max(1, rule.interval)

  switch (rule.frequency) {
    case GuildScheduledEventRecurrenceRuleFrequency.Daily:
      segments.push('FREQ=DAILY', `INTERVAL=${interval}`)
      break
    case GuildScheduledEventRecurrenceRuleFrequency.Weekly: {
      segments.push('FREQ=WEEKLY', `INTERVAL=${interval}`)
      let byDay: string
      if (rule.byNWeekday?.length) {
        byDay = rule.byNWeekday.map((nw) => `${nw.n}${discordWeekdayToByDay(nw.day)}`).join(',')
      } else if (rule.byWeekday?.length) {
        byDay = rule.byWeekday.map(discordWeekdayToByDay).join(',')
      } else {
        byDay = discordWeekdayToByDay(utcDateToDiscordWeekday(firstOccurrenceStartUtc))
      }
      segments.push(`BYDAY=${byDay}`)
      break
    }
    case GuildScheduledEventRecurrenceRuleFrequency.Monthly:
      segments.push('FREQ=MONTHLY', `INTERVAL=${interval}`)
      if (rule.byMonth?.length) {
        segments.push(`BYMONTH=${rule.byMonth.join(',')}`)
      }
      if (rule.byMonthDay?.length) {
        segments.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
      } else {
        segments.push(`BYMONTHDAY=${firstOccurrenceStartUtc.getUTCDate()}`)
      }
      break
    case GuildScheduledEventRecurrenceRuleFrequency.Yearly:
      segments.push('FREQ=YEARLY', `INTERVAL=${interval}`)
      if (rule.byMonth?.length) {
        segments.push(`BYMONTH=${rule.byMonth.join(',')}`)
      } else {
        segments.push(`BYMONTH=${firstOccurrenceStartUtc.getUTCMonth() + 1}`)
      }
      if (rule.byMonthDay?.length) {
        segments.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`)
      } else {
        segments.push(`BYMONTHDAY=${firstOccurrenceStartUtc.getUTCDate()}`)
      }
      break
    default:
      return null
  }

  if (rule.count != null && rule.count > 0) {
    segments.push(`COUNT=${rule.count}`)
  } else if (rule.endTimestamp != null && Number.isFinite(rule.endTimestamp)) {
    segments.push(`UNTIL=${formatUntilUtc(new Date(rule.endTimestamp))}`)
  }

  if (rule.byYearDay?.length) {
    segments.push(`BYYEARDAY=${rule.byYearDay.join(',')}`)
  }

  return `RRULE:${segments.join(';')}`
}
