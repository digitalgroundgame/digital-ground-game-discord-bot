import { CalendarSyncInProgressError } from '../models/control-api/calendar-sync.js'
import { SingleFlight } from './single-flight.js'

export class CalendarSyncRunner {
  private singleFlight = new SingleFlight()

  public constructor(private executeSync: () => Promise<void>) {}

  public async run(): Promise<void> {
    const release = this.singleFlight.acquire()
    if (!release) {
      throw new CalendarSyncInProgressError()
    }

    try {
      await this.executeSync()
    } finally {
      release()
    }
  }
}
