import schedule, { type JobCallback, type Spec } from 'node-schedule'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Logs from '../../lang/logs.json' with { type: 'json' }
import { type Job } from '../../src/jobs/index.js'
import { JobService, Logger } from '../../src/services/index.js'

vi.mock('node-schedule', () => ({
  default: {
    scheduleJob: vi.fn(),
  },
}))

function createJob(name: string, run: () => Promise<void>, log = false): Job {
  return {
    name,
    log,
    schedule: '* * * * * *',
    runOnce: false,
    initialDelaySecs: 0,
    run,
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill
  })

  return { promise, resolve }
}

describe('JobService', () => {
  let callbacks: JobCallback[]
  let cancelMocks: Array<ReturnType<typeof vi.fn>>

  beforeEach(() => {
    callbacks = []
    cancelMocks = []

    vi.mocked(schedule.scheduleJob).mockReset()
    vi.mocked(schedule.scheduleJob).mockImplementation(((_spec: Spec, callback: JobCallback) => {
      const cancel = vi.fn(() => true)
      callbacks.push(callback)
      cancelMocks.push(cancel)

      return { cancel }
    }) as unknown as typeof schedule.scheduleJob)

    vi.spyOn(Logger, 'info').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Logger, 'error').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not register duplicate schedules when started more than once', () => {
    const service = new JobService([createJob('job', vi.fn().mockResolvedValue(undefined))])

    service.start()
    service.start()

    expect(schedule.scheduleJob).toHaveBeenCalledOnce()
  })

  it('cancels every scheduled job and can be started again', () => {
    const service = new JobService([
      createJob('first', vi.fn().mockResolvedValue(undefined)),
      createJob('second', vi.fn().mockResolvedValue(undefined)),
    ])

    service.start()
    service.stop()

    expect(cancelMocks).toHaveLength(2)
    expect(cancelMocks[0]).toHaveBeenCalledOnce()
    expect(cancelMocks[1]).toHaveBeenCalledOnce()

    service.start()

    expect(schedule.scheduleJob).toHaveBeenCalledTimes(4)
  })

  it('reports an invalid schedule without retaining an empty scheduled job', () => {
    vi.mocked(schedule.scheduleJob).mockReturnValueOnce(null as never)
    const service = new JobService([createJob('invalid job', vi.fn().mockResolvedValue(undefined))])

    service.start()

    expect(Logger.error).toHaveBeenCalledWith(
      Logs.error.jobSchedule
        .replaceAll('{JOB}', 'invalid job')
        .replaceAll('{SCHEDULE}', '* * * * * *'),
    )
    expect(Logger.info).not.toHaveBeenCalledWith(
      Logs.info.jobScheduled
        .replaceAll('{JOB}', 'invalid job')
        .replaceAll('{SCHEDULE}', '* * * * * *'),
    )
    expect(() => service.stop()).not.toThrow()
  })

  it('skips an overlapping run of the same job and resumes after completion', async () => {
    const deferred = createDeferred()
    const run = vi.fn(() => deferred.promise)
    const service = new JobService([createJob('slow job', run)])
    service.start()

    const firstRun = Promise.resolve(callbacks[0]?.(new Date()))
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

    await callbacks[0]?.(new Date())

    expect(run).toHaveBeenCalledOnce()
    expect(Logger.warn).toHaveBeenCalledWith(
      Logs.warn.jobSkipped.replaceAll('{JOB}', 'slow job').replaceAll('{DURATION_SECONDS}', '0'),
    )

    deferred.resolve()
    await firstRun
    await callbacks[0]?.(new Date())

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports elapsed time and escalates a stuck run once', async () => {
    const deferred = createDeferred()
    const run = vi.fn(() => deferred.promise)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const service = new JobService([createJob('stuck job', run)])
    service.start()

    const firstRun = Promise.resolve(callbacks[0]?.(new Date()))
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

    now.mockReturnValue(6_000)
    await callbacks[0]?.(new Date())

    expect(Logger.warn).toHaveBeenCalledWith(
      Logs.warn.jobSkipped.replaceAll('{JOB}', 'stuck job').replaceAll('{DURATION_SECONDS}', '5'),
    )

    now.mockReturnValue(3_601_000)
    await callbacks[0]?.(new Date())
    await callbacks[0]?.(new Date())

    expect(Logger.error).toHaveBeenCalledOnce()
    expect(Logger.error).toHaveBeenCalledWith(
      Logs.error.jobStuck.replaceAll('{JOB}', 'stuck job').replaceAll('{DURATION_SECONDS}', '3600'),
    )

    deferred.resolve()
    await firstRun
  })

  it('allows different jobs to run concurrently', async () => {
    const firstDeferred = createDeferred()
    const secondDeferred = createDeferred()
    const firstRun = vi.fn(() => firstDeferred.promise)
    const secondRun = vi.fn(() => secondDeferred.promise)
    const service = new JobService([createJob('first', firstRun), createJob('second', secondRun)])
    service.start()

    const firstInvocation = Promise.resolve(callbacks[0]?.(new Date()))
    const secondInvocation = Promise.resolve(callbacks[1]?.(new Date()))
    await vi.waitFor(() => {
      expect(firstRun).toHaveBeenCalledOnce()
      expect(secondRun).toHaveBeenCalledOnce()
    })

    firstDeferred.resolve()
    secondDeferred.resolve()
    await Promise.all([firstInvocation, secondInvocation])
  })

  it('allows the next run after a failure', async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(undefined)
    const service = new JobService([createJob('job', run)])
    service.start()

    await callbacks[0]?.(new Date())
    await callbacks[0]?.(new Date())

    expect(run).toHaveBeenCalledTimes(2)
    expect(Logger.error).toHaveBeenCalledOnce()
  })

  it('logs the start and completion of jobs configured for informational logging', async () => {
    const service = new JobService([
      createJob('logged job', vi.fn().mockResolvedValue(undefined), true),
    ])
    service.start()

    await callbacks[0]?.(new Date())

    expect(Logger.info).toHaveBeenCalledWith(Logs.info.jobRun.replaceAll('{JOB}', 'logged job'))
    expect(Logger.info).toHaveBeenCalledWith(
      Logs.info.jobCompleted.replaceAll('{JOB}', 'logged job'),
    )
  })
})
