import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { FindWorkPayoutService } from '../services/find-work-payout-service.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Settle `/find-work` claims: pay Democracy Points for issues that closed as
 * completed and reviews that were submitted, and expire the rest.
 *
 * Costs one GitHub read per live issue claim and two per live review request.
 * Hourly means a payout lands within the hour of the work finishing.
 */
export class PayFindWorkJob extends Job {
  public name = 'Pay Find Work'
  public schedule: string = Config.jobs.payFindWork?.schedule ?? '0 45 * * * *'
  public log: boolean = Config.jobs.payFindWork?.log ?? false
  public override runOnce: boolean = Config.jobs.payFindWork?.runOnce ?? false
  public override initialDelaySecs: number = Config.jobs.payFindWork?.initialDelaySecs ?? 0

  constructor(private payoutService: FindWorkPayoutService) {
    super()
  }

  public async run(): Promise<void> {
    // Read failures are logged by the GitHub services and leave the claim for
    // the next run.
    await this.payoutService.run()
  }
}
