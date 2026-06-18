import { and, eq, gt } from 'drizzle-orm'

import { type Database } from '../database/index.js'
import { scheduledEventTable, type ScheduledEvent } from '../database/schema.js'
import { Logger } from './logger.js'

/**
 * Manages Discord scheduled events table
 */
export class ScheduledEventsService {
  constructor(private readonly db: Database) {}

  // Fetch individual event
  public async getEvent(id: string): Promise<ScheduledEvent | undefined> {
    return this.db.query.scheduledEventTable.findFirst({
      where: and(eq(scheduledEventTable.id, id)),
    })
  }

  // Fetches all events in the future
  public async getAllFutureEvents(): Promise<Array<ScheduledEvent>> {
    const now = new Date()
    return this.db.query.scheduledEventTable.findMany({
      where: gt(scheduledEventTable.startTime, now),
    })
  }

  // Updates an existing event with latest name and start time
  public async updateEvent(
    eventId: string,
    eventName: string,
    eventStartTime: Date,
  ): Promise<void> {
    this.db.transaction((tx) => {
      tx.update(scheduledEventTable)
        .set({ name: eventName, startTime: eventStartTime })
        .where(eq(scheduledEventTable.id, eventId))
        .run()
    })

    Logger.info(
      `Updated ScheduledEvent ${eventId}: name -> ${eventName}, start -> ${eventStartTime}`,
    )
  }

  // Adds a new scheduled event based on a Discord ScheduledEvent
  public async addEvent(eventId: string, eventName: string, eventStartTime: Date): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(scheduledEventTable)
        .values({
          id: eventId,
          name: eventName,
          startTime: eventStartTime,
          hasSentNotification: false,
        })
        .run()
    })

    Logger.info(`Added ScheduledEvent: ${eventId} (${eventName}) @ ${eventStartTime}`)
  }

  // Set scheduled event's notification sent flag to true
  public async setNotificationSentFlag(eventId: string): Promise<void> {
    // Set flag to 1
    this.db.transaction((tx) => {
      tx.update(scheduledEventTable)
        .set({ hasSentNotification: true })
        .where(eq(scheduledEventTable.id, eventId))
        .run()
    })

    Logger.info(`Marked ScheduledEvent ${eventId} as notified!`)
  }

  // Set scheduled event's notification sent flag to false
  public async clearNotificationSentFlag(eventId: string): Promise<void> {
    // Set flag to 0
    this.db.transaction((tx) => {
      tx.update(scheduledEventTable)
        .set({ hasSentNotification: false })
        .where(eq(scheduledEventTable.id, eventId))
        .run()
    })

    Logger.info(`Cleared ScheduledEvent ${eventId} notification flag!`)
  }
}
