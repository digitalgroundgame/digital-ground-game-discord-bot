import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { GitHubPullRequestsService } from '../services/github-pull-requests-service.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Re-read open pull requests and who has worked on the files they change, so
 * `/give-issue` can suggest reviews without walking histories mid-interaction.
 *
 * Costs, per refresh: one request per public repo for its pulls, two per open
 * pull request (files and reviews), and one GraphQL query per twenty changed
 * files. Even a few hundred files in flight stays far inside the 5,000/hour
 * authenticated budget, so hourly is comfortable.
 */
export class RefreshGitHubPullRequestsJob extends Job {
  public name = 'Refresh GitHub Pull Requests'
  public schedule: string = Config.jobs.refreshGitHubPullRequests?.schedule ?? '0 30 * * * *'
  public log: boolean = Config.jobs.refreshGitHubPullRequests?.log ?? false
  public override runOnce: boolean = Config.jobs.refreshGitHubPullRequests?.runOnce ?? false
  public override initialDelaySecs: number =
    Config.jobs.refreshGitHubPullRequests?.initialDelaySecs ?? 0

  constructor(private githubPullRequestsService: GitHubPullRequestsService) {
    super()
  }

  public async run(): Promise<void> {
    // Failures are logged by the service and leave the previous data cached.
    await this.githubPullRequestsService.refresh()
  }
}
