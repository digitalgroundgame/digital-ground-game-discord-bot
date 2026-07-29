import { CronExpressionParser } from 'cron-parser'
import { DateTime } from 'luxon'
import schedule from 'node-schedule'
import { type Job as ScheduledJob } from 'node-schedule'
import { createRequire } from 'node:module'

import { Logger } from './index.js'
import { type Job } from '../jobs/index.js'

const require = createRequire(import.meta.url)
const Logs = require('../../lang/logs.json')

export class JobService {
  private inFlightJobs = new Set<Job>()
  private scheduledJobs: ScheduledJob[] = []
  private started = false

  constructor(private jobs: Job[]) {}

  public start(): void {
    if (this.started) {
      return
    }

    this.started = true

    for (const job of this.jobs) {
      const jobSchedule = job.runOnce
        ? CronExpressionParser.parse(job.schedule, {
            currentDate: DateTime.now().plus({ seconds: job.initialDelaySecs }).toJSDate(),
          })
            .next()
            .toDate()
        : {
            start: DateTime.now().plus({ seconds: job.initialDelaySecs }).toJSDate(),
            rule: job.schedule,
          }

      const scheduledJob = schedule.scheduleJob(jobSchedule, async () => {
        if (this.inFlightJobs.has(job)) {
          Logger.warn(Logs.warn.jobSkipped.replaceAll('{JOB}', job.name))
          return
        }

        this.inFlightJobs.add(job)

        try {
          if (job.log) {
            Logger.info(Logs.info.jobRun.replaceAll('{JOB}', job.name))
          }

          await job.run()

          if (job.log) {
            Logger.info(Logs.info.jobCompleted.replaceAll('{JOB}', job.name))
          }
        } catch (error) {
          Logger.error(Logs.error.job.replaceAll('{JOB}', job.name), error)
        } finally {
          this.inFlightJobs.delete(job)
        }
      })
      this.scheduledJobs.push(scheduledJob)
      Logger.info(
        Logs.info.jobScheduled.replaceAll('{JOB}', job.name).replaceAll('{SCHEDULE}', job.schedule),
      )
    }
  }

  public stop(): void {
    for (const scheduledJob of this.scheduledJobs) {
      scheduledJob.cancel()
    }

    this.scheduledJobs = []
    this.started = false
  }
}
