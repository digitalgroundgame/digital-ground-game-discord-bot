import fetch from 'node-fetch'

import { Logger } from './logger.js'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

export type AddTeamMemberResult =
  | { status: 'active' }
  | { status: 'pending' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }

/**
 * Adds members to GitHub organization teams via the REST API.
 *
 * Requires a token that is *both* owned by an organization owner or team
 * maintainer *and* scoped to write team membership: the "Members" org
 * permission for a fine-grained PAT / GitHub App installation token, or the
 * `admin:org` scope for a classic PAT (`write:org` is not enough — GitHub
 * rejects it with the same "must be an organization owner or team
 * maintainer" message it uses for an under-privileged account).
 *
 * See: https://docs.github.com/en/rest/teams/members#add-or-update-team-membership-for-a-user
 */
export class GitHubTeamsService {
  private readonly token: string | undefined

  constructor(token: string | undefined) {
    this.token = token?.trim() || undefined
  }

  /** True when a token is set. */
  public isConfigured(): boolean {
    return this.token !== undefined
  }

  /**
   * Add `username` to `team` (slug) in `org`. The endpoint is an idempotent
   * upsert, so GitHub doesn't distinguish "already a member" from "newly
   * added" — both come back as `active`. A user who isn't yet in the
   * organization instead gets an emailed invite and comes back `pending`
   * until they accept it.
   */
  public async addMember(org: string, team: string, username: string): Promise<AddTeamMemberResult> {
    const token = this.token
    if (!token) return { status: 'not-configured' }

    const url = `${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(username)}`
    try {
      const res = await fetch(url, {
        method: 'put',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        body: JSON.stringify({ role: 'member' }),
      })

      if (res.ok) {
        const body = (await res.json()) as { state?: string }
        return body.state === 'pending' ? { status: 'pending' } : { status: 'active' }
      }

      const text = await res.text().catch(() => '')
      const message = `${res.status} ${text}`.trim()
      Logger.error(`GitHub Teams: failed to add ${username} to ${org}/${team}: ${message}`)
      return { status: 'error', message }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      Logger.error(`GitHub Teams: request failed for ${username} -> ${org}/${team}: ${message}`, err)
      return { status: 'error', message }
    }
  }
}
