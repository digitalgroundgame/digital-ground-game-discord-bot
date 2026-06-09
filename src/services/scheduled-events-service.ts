import { and, eq } from 'drizzle-orm'

import { type Database } from '../database/index.js'
import {
  scheduledEventTable,
  type ScheduledEvent,
} from '../database/schema.js'
import { Logger } from './logger.js'

// Fields captured from an external account when it is linked.
// export interface LinkAccountInput {
//   externalId: string
//   email?: string
//   displayName?: string
// }

/**
 * Manages Discord scheduled events table
 */
export class ScheduledEventsService {
  constructor(private readonly db: Database) {}

  // Fetch individual event
  public async getEvent(id: string): Promise<ScheduledEvent | undefined> {
    return this.db.query.scheduledEventTable.findFirst({
      where: and(
        eq(scheduledEventTable.id, id)
      ),
    })
  }
  
  // Fetches all events
  public async getAllEvents(): Promise<Array<ScheduledEvent>> {
    // Get all events
    return []
  }

  // Set scheduled event's notification sent flag to true
  public async setNotificationSentFlag(
    eventId: string,
  ): Promise<void> {
    // Set flag to 1
  }
  
  // Set scheduled event's notification sent flag to false
  public async clearNotificationSentFlag(
    eventId: string,
  ): Promise<void> {
    // Set flag to 0
  }
}
