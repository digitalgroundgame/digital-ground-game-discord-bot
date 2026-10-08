import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { GitHubIssuesService } from '../services/github-issues-service.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Re-read the pool of claimable issues `/give-issue` draws from, so labelling
 * an issue on GitHub makes it offerable without a redeploy.
 *
 * Costs one request per public repo plus one to enumerate them, against an
 * authenticated budget of 5,000/hour, so hourly is comfortable. A shorter
 * schedule mainly buys a smaller window in which a freshly labelled issue is
 * invisible — and a longer one a bigger window in which a claimed issue is
 * still offered, though `GitHubIssuesService.assign` drops those from the
 * cache as they are taken.
 */
export class RefreshGitHubIssuesJob extends Job {
  public name = 'Refresh GitHub Issues'
  public schedule: string = Config.jobs.refreshGitHubIssues?.schedule ?? '0 0 * * * *'
  public log: boolean = Config.jobs.refreshGitHubIssues?.log ?? false
  public override runOnce: boolean = Config.jobs.refreshGitHubIssues?.runOnce ?? false
  public override initialDelaySecs: number = Config.jobs.refreshGitHubIssues?.initialDelaySecs ?? 0

  constructor(private githubIssuesService: GitHubIssuesService) {
    super()
  }

  public async run(): Promise<void> {
    // Failures are logged by the service and leave the previous pool cached;
    // there is nothing useful to escalate to the job runner.
    await this.githubIssuesService.refreshIssues()
  }
}
