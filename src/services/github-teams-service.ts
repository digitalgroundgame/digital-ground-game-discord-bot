import fetch from 'node-fetch'

import { githubGraphql } from './github-api.js'
import { Logger } from './logger.js'
import {
  DEFAULT_GITHUB_TEAM_ROLE,
  GitHubExcludedTeamSlugs,
  type GitHubTeam,
  type GitHubTeamRole,
} from '../constants/github-teams.js'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
/** Without this a stalled connection never settles, leaving the deferred interaction hanging. */
const REQUEST_TIMEOUT_MS = 10_000
/** GitHub's maximum; the org fits in one page well below it. */
const TEAMS_PAGE_SIZE = 100
/** Matches `repositories(first: 100)` in `MEMBER_TEAM_REPOS_QUERY`. */
const TEAM_REPOS_PAGE_SIZE = 100
/** Bounds the paging loop if GitHub ever stops shrinking the final page. */
const MAX_TEAM_PAGES = 10
/**
 * How long a failed on-demand refresh suppresses the next one. Autocomplete
 * fires per keystroke, so without this a cold cache plus a failing API would
 * mean one request per character typed.
 */
const REFRESH_RETRY_COOLDOWN_MS = 60_000

/**
 * A member's teams in the org, each team's full ancestor chain, and the
 * repositories each can reach. 100 of each is GitHub's page maximum and well
 * past what one member holds; anything beyond it is dropped rather than paged,
 * since this runs inside a command, and logged so the limit doesn't go
 * unnoticed.
 */
const MEMBER_TEAM_REPOS_QUERY = `
  query ($org: String!, $login: String!) {
    organization(login: $org) {
      teams(first: 100, userLogins: [$login]) {
        pageInfo { hasNextPage }
        nodes {
          slug
          ancestors(first: 100) { nodes { slug } }
          repositories(first: 100) {
            pageInfo { hasNextPage }
            nodes { nameWithOwner }
          }
        }
      }
    }
  }
`

/** The member's teams and the repositories they reach, as `/find-work` matches on them. */
export interface MemberTeamRepos {
  /** Team slugs, lowercased, minus excluded teams. */
  teams: string[]
  /** `owner/name` of every repository those teams reach, lowercased. */
  repos: ReadonlySet<string>
}

interface PageInfo {
  hasNextPage?: unknown
}

interface MemberTeamNode {
  slug?: unknown
  ancestors?: { nodes?: ({ slug?: unknown } | null)[] | null } | null
  repositories?: {
    pageInfo?: PageInfo | null
    nodes?: ({ nameWithOwner?: unknown } | null)[] | null
  } | null
}

export type AddTeamMemberResult =
  | { status: 'active' }
  | { status: 'pending' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }

function isGitHubTeam(value: unknown): value is GitHubTeam {
  if (typeof value !== 'object' || value === null) return false
  const team = value as Partial<GitHubTeam>
  return (
    typeof team.name === 'string' &&
    typeof team.slug === 'string' &&
    team.name !== '' &&
    team.slug !== ''
  )
}

function describeError(err: unknown): string {
  // node-fetch rejects an aborted request with `AbortError`; native fetch uses
  // `TimeoutError` for `AbortSignal.timeout`. The only signal here is the
  // timeout, so treat both as one.
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return `no response after ${REQUEST_TIMEOUT_MS}ms`
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * Reads and writes GitHub organization team membership via the REST API.
 *
 * The org's teams are discovered rather than configured: `refreshTeams`
 * caches the list in memory (see `RefreshGitHubTeamsJob`) so `/grant-access`
 * autocomplete can be served synchronously, well inside Discord's three
 * second deadline. The cache is also what `/grant-access` resolves teams
 * against: only listed teams can be granted, and each team's cached parent
 * decides whether an exclusion covers it. A stale cache can therefore lag a
 * team's creation or move by up to one refresh.
 *
 * Requires a token that is *both* owned by an organization owner or team
 * maintainer *and* scoped to write team membership: the "Members" org
 * permission for a fine-grained PAT / GitHub App installation token, or the
 * `admin:org` scope for a classic PAT (`write:org` is not enough — GitHub
 * rejects it with the same "must be an organization owner or team
 * maintainer" message it uses for an under-privileged account). The same
 * token reads the team list, which needs no additional scope.
 *
 * See: https://docs.github.com/en/rest/teams/members#add-or-update-team-membership-for-a-user
 */
export class GitHubTeamsService {
  private readonly token: string | undefined
  private readonly org: string | undefined
  private teams: GitHubTeam[] = []
  /** Shared by concurrent callers so a cold cache triggers one request, not N. */
  private refreshPromise: Promise<boolean> | null = null
  private lastRefreshAttempt = 0

  constructor(token: string | undefined, org: string | undefined) {
    this.token = token?.trim() || undefined
    this.org = org?.trim() || undefined
  }

  /** True when both a token and an organization are set. */
  public isConfigured(): boolean {
    return this.token !== undefined && this.org !== undefined
  }

  /** The organization teams are discovered from, if configured. */
  public get organization(): string | undefined {
    return this.org
  }

  /** The teams cached by the last successful refresh. Never throws, never blocks. */
  public getTeams(): readonly GitHubTeam[] {
    return this.teams
  }

  /**
   * Kick off a refresh if the cache is still empty, without waiting for it.
   * Safe to call from autocomplete: it returns immediately, coalesces
   * concurrent callers, and backs off after a failure.
   */
  public warmTeams(): void {
    if (!this.isConfigured() || this.teams.length > 0 || this.refreshPromise) return
    if (Date.now() - this.lastRefreshAttempt < REFRESH_RETRY_COOLDOWN_MS) return
    void this.refreshTeams()
  }

  /**
   * Re-read the org's teams into the cache. Returns whether the cache now
   * holds a freshly fetched list; a failure leaves the previous list in place
   * rather than emptying it.
   */
  public async refreshTeams(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.fetchTeams().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async fetchTeams(): Promise<boolean> {
    const token = this.token
    const org = this.org
    this.lastRefreshAttempt = Date.now()
    if (!token || !org) return false

    const collected: GitHubTeam[] = []
    try {
      for (let page = 1; page <= MAX_TEAM_PAGES; page++) {
        const url = `${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/teams?per_page=${TEAMS_PAGE_SIZE}&page=${page}`
        const res = await fetch(url, {
          method: 'get',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          const message = `${res.status} ${text}`.trim()
          Logger.error(`GitHub Teams: failed to list teams for ${org}: ${message}`)
          return false
        }

        const body: unknown = await res.json()
        if (!Array.isArray(body)) {
          Logger.error(`GitHub Teams: expected an array of teams for ${org}`)
          return false
        }

        for (const entry of body) {
          if (!isGitHubTeam(entry)) continue
          // Kept so an exclusion can cover the child teams that inherit its access.
          const parent = (entry as { parent?: { slug?: unknown } | null }).parent
          const parentSlug = typeof parent?.slug === 'string' ? parent.slug : null
          collected.push({ name: entry.name, slug: entry.slug, parentSlug })
        }
        if (body.length < TEAMS_PAGE_SIZE) break
      }
    } catch (err: unknown) {
      Logger.error(`GitHub Teams: failed to list teams for ${org}: ${describeError(err)}`, err)
      return false
    }

    this.teams = collected
    Logger.info(`GitHub Teams: cached ${collected.length} team(s) from ${org}`)
    return true
  }

  /**
   * Read the org teams `login` belongs to and the repositories they reach.
   * `/find-work` matches a member's issues on these: membership is what
   * `/grant-access` hands out, so it is the org's own record of who works on
   * what.
   *
   * Read live rather than from the hourly cache, so access granted a minute
   * ago counts. Teams in `grantAccess.excludeTeams`, and their children, are
   * left out: those are leadership or admin teams that tend to reach every
   * repository, which would make every issue a match. Returns null when the
   * service isn't configured or GitHub can't answer, so the caller can tell
   * "no teams" apart from "couldn't tell".
   */
  public async getMemberTeamRepos(
    login: string,
    excluded: ReadonlySet<string> = GitHubExcludedTeamSlugs,
  ): Promise<MemberTeamRepos | null> {
    const token = this.token
    const org = this.org
    if (!token || !org) return null

    let nodes: MemberTeamNode[]
    try {
      const data = (await githubGraphql(token, MEMBER_TEAM_REPOS_QUERY, { org, login })) as {
        organization?: {
          teams?: { pageInfo?: PageInfo | null; nodes?: (MemberTeamNode | null)[] | null } | null
        } | null
      } | null
      const connection = data?.organization?.teams
      nodes = (connection?.nodes ?? []).filter((node): node is MemberTeamNode => node !== null)
      if (connection?.pageInfo?.hasNextPage === true) {
        Logger.warn(
          `GitHub Teams: ${login} is on more than ${nodes.length} teams in ${org}; the rest are ignored`,
        )
      }
    } catch (err: unknown) {
      Logger.error(
        `GitHub Teams: failed to read ${login}'s teams in ${org}: ${describeError(err)}`,
        err,
      )
      return null
    }

    // Each team arrives with its whole ancestor chain, so an excluded team
    // covers every level beneath it without relying on the hourly cache,
    // which may still be cold.
    const teams: string[] = []
    const repos = new Set<string>()
    for (const node of nodes) {
      if (typeof node.slug !== 'string') continue
      const lineage = [
        node.slug,
        ...(node.ancestors?.nodes ?? []).flatMap((ancestor) =>
          typeof ancestor?.slug === 'string' ? [ancestor.slug] : [],
        ),
      ]
      if (lineage.some((slug) => excluded.has(slug.trim().toLowerCase()))) continue

      teams.push(node.slug.toLowerCase())
      for (const repo of node.repositories?.nodes ?? []) {
        if (typeof repo?.nameWithOwner === 'string') repos.add(repo.nameWithOwner.toLowerCase())
      }
      if (node.repositories?.pageInfo?.hasNextPage === true) {
        Logger.warn(
          `GitHub Teams: ${org}/${node.slug} reaches more than ${TEAM_REPOS_PAGE_SIZE} repositories; the rest won't match in /find-work`,
        )
      }
    }
    return { teams, repos }
  }

  /**
   * Add `username` to the `team` slug in the configured org at `role`. The
   * endpoint is an idempotent upsert, so GitHub doesn't distinguish "already a
   * member" from "newly added" — both come back as `active`, and re-running
   * with a different role promotes or demotes in place. A user who isn't yet in
   * the organization instead gets an emailed invite and comes back `pending`
   * until they accept it. An unknown slug comes back as an `error`. Callers
   * must resolve `team` against the cache first, since exclusions are applied
   * there and not here.
   */
  public async addMember(
    team: string,
    username: string,
    role: GitHubTeamRole = DEFAULT_GITHUB_TEAM_ROLE,
  ): Promise<AddTeamMemberResult> {
    const token = this.token
    const org = this.org
    if (!token || !org) return { status: 'not-configured' }

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
        body: JSON.stringify({ role }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.ok) {
        const body = (await res.json()) as { state?: string }
        return body.state === 'pending' ? { status: 'pending' } : { status: 'active' }
      }

      const text = await res.text().catch(() => '')
      const message = `${res.status} ${text}`.trim()
      Logger.error(
        `GitHub Teams: failed to add ${username} to ${org}/${team} as ${role}: ${message}`,
      )
      return { status: 'error', message }
    } catch (err: unknown) {
      const message = describeError(err)
      Logger.error(
        `GitHub Teams: request failed for ${username} -> ${org}/${team} as ${role}: ${message}`,
        err,
      )
      return { status: 'error', message }
    }
  }
}
