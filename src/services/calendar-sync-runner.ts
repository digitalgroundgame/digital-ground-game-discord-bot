export class CalendarSyncInProgressError extends Error {
  public constructor() {
    super('A calendar sync is already in progress.')
  }
}

export class CalendarSyncRunner {
  private inProgress = false

  public constructor(private executeSync: () => Promise<void>) {}

  public async run(): Promise<void> {
    if (this.inProgress) {
      throw new CalendarSyncInProgressError()
    }

    this.inProgress = true
    try {
      await this.executeSync()
    } finally {
      this.inProgress = false
    }
  }
}
