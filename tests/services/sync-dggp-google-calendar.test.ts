import type {
  Client,
  GuildScheduledEvent,
  GuildScheduledEventRecurrenceRuleMonth,
  GuildScheduledEventRecurrenceRuleNWeekday,
  GuildScheduledEventRecurrenceRuleWeekday,
} from 'discord.js'
import {
  Collection,
  GuildScheduledEventRecurrenceRuleFrequency,
  GuildScheduledEventStatus,
} from 'discord.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GoogleCalendarService } from '../../src/services/google-calendar-service.js'
import {
  buildCalendarInputFromDiscordEvent,
  listWindowForDiscordEvents,
  syncDggpScheduledEventsToGoogle,
} from '../../src/services/sync-dggp-google-calendar.js'

/** Plain object overrides only — avoid `Partial<GuildScheduledEvent>` (class `Base` adds `valueOf(): string`). */
type MockScheduledEventOverrides = Partial<
  Pick<
    GuildScheduledEvent,
    | 'id'
    | 'name'
    | 'description'
    | 'url'
    | 'scheduledStartAt'
    | 'scheduledEndAt'
    | 'scheduledStartTimestamp'
    | 'scheduledEndTimestamp'
    | 'status'
    | 'entityMetadata'
  >
> & {
  /** Shape used at runtime by sync / RRULE helper (`startAt`/`endAt` are discord.js getters only). */
  recurrenceRule?: {
    frequency: GuildScheduledEventRecurrenceRuleFrequency
    interval: number
    startTimestamp: number
    endTimestamp: number | null
    byWeekday?: readonly GuildScheduledEventRecurrenceRuleWeekday[] | null
    byNWeekday?: readonly GuildScheduledEventRecurrenceRuleNWeekday[] | null
    byMonth?: readonly GuildScheduledEventRecurrenceRuleMonth[] | null
    byMonthDay?: readonly number[] | null
    byYearDay?: readonly number[] | null
    count?: number | null
  } | null
}

function mockScheduledEvent(partial: MockScheduledEventOverrides = {}): GuildScheduledEvent {
  const start = new Date('2026-06-01T18:00:00.000Z')
  const end = new Date('2026-06-01T20:00:00.000Z')
  return {
    id: 'evt_discord_1',
    name: 'Town hall',
    description: 'Agenda items',
    url: 'https://discord.com/events/guild/scheduled/1',
    scheduledStartAt: start,
    scheduledEndAt: end,
    scheduledStartTimestamp: start.getTime(),
    scheduledEndTimestamp: end.getTime(),
    status: GuildScheduledEventStatus.Scheduled,
    entityMetadata: null,
    recurrenceRule: null,
    ...partial,
  } as GuildScheduledEvent
}

function mockClientWithGuild(events: GuildScheduledEvent[]): Client {
  const collection = new Collection<string, GuildScheduledEvent>()
  for (const e of events) {
    collection.set(e.id, e)
  }
  const guild = {
    name: 'DGGPATestServer',
    scheduledEvents: {
      fetch: vi.fn().mockResolvedValue(collection),
    },
  }
  return {
    guilds: {
      cache: {
        find: (pred: (g: { name: string }) => boolean) =>
          pred(guild as { name: string }) ? guild : undefined,
      },
    },
  } as unknown as Client
}

function createCalendarServiceMock(
  overrides: Partial<GoogleCalendarService> = {},
): GoogleCalendarService {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    ensureInitialized: vi.fn().mockResolvedValue(true),
    listEventsBetween: vi.fn().mockResolvedValue([]),
    findEventByDiscordId: vi.fn().mockResolvedValue(null),
    getListedEvent: vi.fn().mockResolvedValue(null),
    createEvent: vi.fn().mockResolvedValue('google_new_id'),
    updateEvent: vi.fn().mockResolvedValue(true),
    deleteEvent: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as GoogleCalendarService
}

describe('buildCalendarInputFromDiscordEvent', () => {
  it('maps summary, times, description suffix, and Discord id', () => {
    const input = buildCalendarInputFromDiscordEvent(mockScheduledEvent())
    expect(input.summary).toBe('Town hall')
    expect(input.start.toISOString()).toBe('2026-06-01T18:00:00.000Z')
    expect(input.end.toISOString()).toBe('2026-06-01T20:00:00.000Z')
    expect(input.discordScheduledEventId).toBe('evt_discord_1')
    expect(input.description).toContain('Agenda items')
    expect(input.description).toContain('Synced from DGGP Discord:')
    expect(input.description).toContain('https://discord.com/events/guild/scheduled/1')
  })

  it('uses only sync line when description is empty', () => {
    const input = buildCalendarInputFromDiscordEvent(mockScheduledEvent({ description: null }))
    expect(input.description).toBe(
      'Synced from DGGP Discord: https://discord.com/events/guild/scheduled/1',
    )
  })

  it('reads location from external entity metadata when present', () => {
    const input = buildCalendarInputFromDiscordEvent(
      mockScheduledEvent({
        entityMetadata: { location: '123 Main St' },
      }),
    )
    expect(input.location).toBe('123 Main St')
  })

  it('adds weekly RRULE when Discord recurrence is weekly', () => {
    const start = new Date('2026-06-02T15:00:00.000Z') // Tuesday UTC
    const input = buildCalendarInputFromDiscordEvent(
      mockScheduledEvent({
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + 60 * 60 * 1000),
        recurrenceRule: {
          frequency: GuildScheduledEventRecurrenceRuleFrequency.Weekly,
          interval: 1,
          startTimestamp: start.getTime(),
          endTimestamp: null,
          byWeekday: null,
          byNWeekday: null,
          byMonth: null,
          byMonthDay: null,
          byYearDay: null,
          count: null,
        },
      }),
    )
    expect(input.recurrence?.length).toBe(1)
    expect(input.recurrence?.[0]).toMatch(/^RRULE:FREQ=WEEKLY/)
    expect(input.recurrence?.[0]).toContain('BYDAY=TU')
  })
})

describe('listWindowForDiscordEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-13T12:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses default past/future window when there are no events', () => {
    const DEFAULT_PAST_MS = 365 * 24 * 60 * 60 * 1000
    const DEFAULT_FUTURE_MS = 3 * 365 * 24 * 60 * 60 * 1000
    const WINDOW_PAD_MS = 7 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const { timeMin, timeMax } = listWindowForDiscordEvents([])
    expect(timeMin).toEqual(new Date(now - DEFAULT_PAST_MS - WINDOW_PAD_MS))
    expect(timeMax).toEqual(new Date(now + DEFAULT_FUTURE_MS + WINDOW_PAD_MS))
  })

  it('extends timeMax when recurrence end is beyond default horizon', () => {
    const start = new Date('2026-05-01T12:00:00.000Z')
    const ruleEnd = new Date('2030-12-31T23:59:59.000Z').getTime()
    const { timeMax } = listWindowForDiscordEvents([
      mockScheduledEvent({
        scheduledStartAt: start,
        scheduledEndAt: new Date(start.getTime() + 3600_000),
        recurrenceRule: {
          frequency: GuildScheduledEventRecurrenceRuleFrequency.Weekly,
          interval: 1,
          startTimestamp: start.getTime(),
          endTimestamp: ruleEnd,
          byWeekday: null,
          byNWeekday: null,
          byMonth: null,
          byMonthDay: null,
          byYearDay: null,
          count: null,
        },
      }),
    ])
    expect(timeMax.getTime()).toBeGreaterThan(new Date('2029-04-13T12:00:00.000Z').getTime())
  })
})

describe('syncDggpScheduledEventsToGoogle', () => {
  it('updates when list misses the link but findEventByDiscordId resolves the Google event', async () => {
    const ev = mockScheduledEvent({ name: 'From find' })
    const client = mockClientWithGuild([ev])
    const start = ev.scheduledStartAt!
    const end = ev.scheduledEndAt!
    const calendar = createCalendarServiceMock({
      listEventsBetween: vi.fn().mockResolvedValue([]),
      findEventByDiscordId: vi.fn().mockResolvedValue('google_via_find'),
      getListedEvent: vi.fn().mockResolvedValue({
        id: 'google_via_find',
        summary: 'Old title',
        start,
        end,
        location: null,
        discordScheduledEventId: 'evt_discord_1',
      }),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.findEventByDiscordId).toHaveBeenCalledWith('evt_discord_1')
    expect(calendar.getListedEvent).toHaveBeenCalledWith('google_via_find')
    expect(calendar.updateEvent).toHaveBeenCalledWith(
      'google_via_find',
      expect.objectContaining({ summary: 'From find' }),
    )
    expect(calendar.createEvent).not.toHaveBeenCalled()
  })

  it('creates a Google event when Discord has one and Google has none', async () => {
    const ev = mockScheduledEvent()
    const client = mockClientWithGuild([ev])
    const calendar = createCalendarServiceMock()

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.createEvent).toHaveBeenCalledTimes(1)
    expect(calendar.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Town hall',
        discordScheduledEventId: 'evt_discord_1',
      }),
    )
    expect(calendar.updateEvent).not.toHaveBeenCalled()
    expect(calendar.deleteEvent).not.toHaveBeenCalled()
  })

  it('updates when linked Google event drifts from Discord', async () => {
    const ev = mockScheduledEvent({ name: 'Updated title' })
    const client = mockClientWithGuild([ev])
    const start = ev.scheduledStartAt!
    const end = ev.scheduledEndAt!
    const calendar = createCalendarServiceMock({
      listEventsBetween: vi.fn().mockResolvedValue([
        {
          id: 'google_1',
          summary: 'Old title',
          start,
          end,
          location: null,
          discordScheduledEventId: 'evt_discord_1',
        },
      ]),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.updateEvent).toHaveBeenCalledWith(
      'google_1',
      expect.objectContaining({ summary: 'Updated title' }),
    )
    expect(calendar.createEvent).not.toHaveBeenCalled()
  })

  it('does not update when linked event already matches', async () => {
    const ev = mockScheduledEvent()
    const client = mockClientWithGuild([ev])
    const calendar = createCalendarServiceMock({
      listEventsBetween: vi.fn().mockResolvedValue([
        {
          id: 'google_1',
          summary: ev.name,
          start: ev.scheduledStartAt!,
          end: ev.scheduledEndAt!,
          location: null,
          discordScheduledEventId: 'evt_discord_1',
        },
      ]),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.updateEvent).not.toHaveBeenCalled()
    expect(calendar.createEvent).not.toHaveBeenCalled()
  })

  it('deletes Google events whose Discord id is gone', async () => {
    const ev = mockScheduledEvent({ id: 'still_here' })
    const client = mockClientWithGuild([ev])
    const calendar = createCalendarServiceMock({
      listEventsBetween: vi.fn().mockResolvedValue([
        {
          id: 'g_orphan',
          summary: 'Stale',
          start: new Date('2026-01-01T12:00:00.000Z'),
          end: new Date('2026-01-01T13:00:00.000Z'),
          discordScheduledEventId: 'removed_from_discord',
        },
        {
          id: 'g_ok',
          summary: ev.name,
          start: ev.scheduledStartAt!,
          end: ev.scheduledEndAt!,
          discordScheduledEventId: 'still_here',
        },
      ]),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.deleteEvent).toHaveBeenCalledWith('g_orphan')
    expect(calendar.deleteEvent).not.toHaveBeenCalledWith('g_ok')
  })

  it('deletes Google event when Discord event is canceled', async () => {
    const ev = mockScheduledEvent({ status: GuildScheduledEventStatus.Canceled })
    const client = mockClientWithGuild([ev])
    const calendar = createCalendarServiceMock({
      listEventsBetween: vi.fn().mockResolvedValue([
        {
          id: 'g_canceled',
          summary: 'Was scheduled',
          start: ev.scheduledStartAt!,
          end: ev.scheduledEndAt!,
          discordScheduledEventId: 'evt_discord_1',
        },
      ]),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.deleteEvent).toHaveBeenCalledWith('g_canceled')
    expect(calendar.createEvent).not.toHaveBeenCalled()
    expect(calendar.updateEvent).not.toHaveBeenCalled()
  })

  it('skips work when calendar service is not configured', async () => {
    const client = mockClientWithGuild([mockScheduledEvent()])
    const calendar = createCalendarServiceMock({
      isConfigured: vi.fn().mockReturnValue(false),
    })

    await syncDggpScheduledEventsToGoogle(client, calendar)

    expect(calendar.ensureInitialized).not.toHaveBeenCalled()
    expect(calendar.listEventsBetween).not.toHaveBeenCalled()
  })
})
