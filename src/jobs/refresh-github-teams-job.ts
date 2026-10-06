import { createRequire } from 'node:module'

import { Job } from './job.js'
import type { GitHubTeamsService } from '../services/github-teams-service.js'

const require = createRequire(import.meta.url)
const Config = require('../../config/config.json')

/**
 * Re-read the GitHub org's teams into the in-memory cache `/grant-access`
 * autocompletes from, so a team created on GitHub becomes selectable without
 * a config change or a redeploy.
 *
 * One request per run for an org this size, against an authenticated budget
 * of 5,000/hour. `initialDelaySecs` is 0 so the cache is warm before the
 * first interaction rather than on first use.
 */
export class RefreshGitHubTeamsJob extends Job {
  public name = 'Refresh GitHub Teams'
  public schedule: string = Config.jobs.refreshGitHubTeams?.schedule ?? '0 0 * * * *'
  public log: boolean = Config.jobs.refreshGitHubTeams?.log ?? false
  public override runOnce: boolean = Config.jobs.refreshGitHubTeams?.runOnce ?? false
  public override initialDelaySecs: number = Config.jobs.refreshGitHubTeams?.initialDelaySecs ?? 0

  constructor(private githubTeamsService: GitHubTeamsService) {
    super()
  }

  public async run(): Promise<void> {
    // Failures are logged by the service and leave the previous list cached;
    // there is nothing useful to escalate to the job runner.
    await this.githubTeamsService.refreshTeams()
  }
}
