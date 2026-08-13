import { CronExpressionParser } from 'cron-parser'
import { DateTime } from 'luxon'
import schedule, { type Job as ScheduledJob } from 'node-schedule'
import { createRequire } from 'node:module'

import { Logger } from './index.js'
import { type Job } from '../jobs/index.js'

const require = createRequire(import.meta.url)
const Logs = require('../../lang/logs.json')

export class JobService {
  private static readonly stuckJobThresholdMs = 60 * 60 * 1000

  private inFlightJobs = new Map<Job, { startedAt: number; stuckReported: boolean }>()
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
        const inFlightJob = this.inFlightJobs.get(job)
        if (inFlightJob) {
          const elapsedMs = Math.max(0, Date.now() - inFlightJob.startedAt)
          const elapsedSeconds = Math.floor(elapsedMs / 1000).toString()

          if (elapsedMs >= JobService.stuckJobThresholdMs && !inFlightJob.stuckReported) {
            inFlightJob.stuckReported = true
            Logger.error(
              Logs.error.jobStuck
                .replaceAll('{JOB}', job.name)
                .replaceAll('{DURATION_SECONDS}', elapsedSeconds),
            )
          } else {
            Logger.warn(
              Logs.warn.jobSkipped
                .replaceAll('{JOB}', job.name)
                .replaceAll('{DURATION_SECONDS}', elapsedSeconds),
            )
          }

          return
        }

        this.inFlightJobs.set(job, { startedAt: Date.now(), stuckReported: false })

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

      if (!scheduledJob) {
        Logger.error(
          Logs.error.jobSchedule
            .replaceAll('{JOB}', job.name)
            .replaceAll('{SCHEDULE}', job.schedule),
        )
        continue
      }

      this.scheduledJobs.push(scheduledJob)
      Logger.info(
        Logs.info.jobScheduled.replaceAll('{JOB}', job.name).replaceAll('{SCHEDULE}', job.schedule),
      )
    }
  }

  /**
   * Cancels future invocations and allows the schedules to be started again.
   * Runs already in flight are neither interrupted nor awaited.
   */
  public stop(): void {
    for (const scheduledJob of this.scheduledJobs) {
      scheduledJob.cancel()
    }

    this.scheduledJobs = []
    this.started = false
  }
}
