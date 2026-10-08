import fetch from 'node-fetch'

import { Logger } from './logger.js'
import {
  type CandidateIssue,
  GiveIssueExcludedRepos,
  GiveIssueMarkerLabel,
} from '../constants/give-issue.js'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'
/** Without this a stalled connection never settles, leaving the deferred interaction hanging. */
const REQUEST_TIMEOUT_MS = 10_000
/** GitHub's maximum. */
const PAGE_SIZE = 100
/** Bounds the paging loops if GitHub ever stops shrinking the final page. */
const MAX_PAGES = 10

export type AssignResult =
  | { status: 'assigned' }
  | { status: 'not-assignable' }
  | { status: 'not-configured' }
  | { status: 'error'; message: string }

interface RawLabel {
  name?: unknown
}

interface RawIssue {
  number?: unknown
  title?: unknown
  html_url?: unknown
  updated_at?: unknown
  labels?: unknown
  pull_request?: unknown
}

function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `no response after ${REQUEST_TIMEOUT_MS}ms`
  }
  return err instanceof Error ? err.message : String(err)
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  return labels
    .map((label: RawLabel | string) =>
      typeof label === 'string' ? label : typeof label.name === 'string' ? label.name : '',
    )
    .filter((name) => name !== '')
    .map((name) => name.toLowerCase())
}

/**
 * Convert one issues-API entry into a candidate, or null if it isn't one.
 * Exported for tests — the filtering rules are the security boundary for what
 * `/give-issue` will show, so they are worth asserting directly.
 */
export function toCandidateIssue(repo: string, raw: RawIssue): CandidateIssue | null {
  // The issues API returns pull requests too; they are not claimable work.
  if (raw.pull_request != null) return null
  if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null
  if (typeof raw.html_url !== 'string' || typeof raw.updated_at !== 'string') return null

  const updatedAt = new Date(raw.updated_at)
  if (Number.isNaN(updatedAt.getTime())) return null

  const labels = labelNames(raw.labels)
  // Belt and braces: the request already filters on the marker label, but a
  // dropped query parameter must not silently widen the pool.
  if (!labels.includes(GiveIssueMarkerLabel)) return null

  return { repo, number: raw.number, title: raw.title, htmlUrl: raw.html_url, labels, updatedAt }
}

/**
 * Reads claimable issues from the org's public repositories and assigns
 * members to them.
 *
 * The pool is cached the way `GitHubTeamsService` caches teams: a draw is
 * served from memory so it lands well inside Discord's interaction deadline,
 * and a failed refresh leaves the previous pool in place rather than emptying
 * it. Unlike the team cache, the pool here is also a privacy boundary — only
 * *public* repositories are enumerated, and only issues carrying the marker
 * label survive `toCandidateIssue`. Both checks are applied independently so
 * that losing one does not expose anything.
 *
 * Needs a token with the repository **Issues** permission at read and write,
 * plus **Metadata** — deliberately a different token from
 * `GITHUB_TEAMS_TOKEN`, which can change org membership and should not also
 * be reachable from a command every member can run.
 */
export class GitHubIssuesService {
  private readonly token: string | undefined
  private readonly org: string | undefined
  private issues: CandidateIssue[] = []
  private refreshPromise: Promise<boolean> | null = null

  constructor(token: string | undefined, org: string | undefined) {
    this.token = token?.trim() || undefined
    this.org = org?.trim() || undefined
  }

  /** True when both a token and an organization are set. */
  public isConfigured(): boolean {
    return this.token !== undefined && this.org !== undefined
  }

  /** The issues cached by the last successful refresh. Never throws, never blocks. */
  public getIssues(): readonly CandidateIssue[] {
    return this.issues
  }

  /**
   * Re-read the claimable pool. Returns whether the cache now holds a freshly
   * fetched list; a failure keeps the previous one.
   */
  public async refreshIssues(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.fetchPool().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async request(path: string): Promise<unknown> {
    const res = await fetch(`${GITHUB_API_BASE}${path}`, {
      method: 'get',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`${res.status} ${text}`.trim())
    }
    return res.json()
  }

  /**
   * Public repositories in the org, as `owner/name`, minus the excluded ones.
   *
   * `type=public` is what keeps private work out of the pool. It is enforced
   * here, at the point repositories are enumerated, rather than by a qualifier
   * on the issue query — a bug in the latter would expose every private issue
   * in the org at once.
   */
  private async listPublicRepos(): Promise<string[]> {
    const repos: string[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const org = encodeURIComponent(this.org ?? '')
      const body = await this.request(
        `/orgs/${org}/repos?type=public&per_page=${PAGE_SIZE}&page=${page}`,
      )
      if (!Array.isArray(body)) throw new Error('expected an array of repositories')

      for (const entry of body) {
        const repo = entry as { full_name?: unknown; private?: unknown; archived?: unknown }
        if (typeof repo.full_name !== 'string') continue
        // `type=public` should already guarantee this. Check anyway.
        if (repo.private === true) continue
        if (repo.archived === true) continue
        if (GiveIssueExcludedRepos.has(repo.full_name.toLowerCase())) continue
        repos.push(repo.full_name)
      }
      if (body.length < PAGE_SIZE) break
    }
    return repos
  }

  private async listClaimableIssues(repo: string): Promise<CandidateIssue[]> {
    const found: CandidateIssue[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const label = encodeURIComponent(GiveIssueMarkerLabel)
      const body = await this.request(
        `/repos/${repo}/issues?state=open&assignee=none&labels=${label}&per_page=${PAGE_SIZE}&page=${page}`,
      )
      if (!Array.isArray(body)) throw new Error(`expected an array of issues for ${repo}`)

      for (const entry of body) {
        const candidate = toCandidateIssue(repo, entry as RawIssue)
        if (candidate) found.push(candidate)
      }
      if (body.length < PAGE_SIZE) break
    }
    return found
  }

  private async fetchPool(): Promise<boolean> {
    if (!this.isConfigured()) return false

    try {
      const repos = await this.listPublicRepos()
      const collected: CandidateIssue[] = []
      // Sequential on purpose: an org this size fits comfortably in the
      // authenticated hourly budget, and GitHub secondary-rate-limits
      // concurrent requests from one token more aggressively than serial ones.
      for (const repo of repos) {
        collected.push(...(await this.listClaimableIssues(repo)))
      }

      this.issues = collected
      Logger.info(
        `GitHub Issues: cached ${collected.length} claimable issue(s) across ${repos.length} public repo(s) in ${this.org}`,
      )
      return true
    } catch (err: unknown) {
      Logger.error(
        `GitHub Issues: failed to refresh the claimable pool for ${this.org}: ${describeError(err)}`,
        err,
      )
      return false
    }
  }

  /**
   * Whether GitHub will accept `username` as an assignee on `repo`. Returns
   * false for a user without read access, which for a public org repo mostly
   * means someone who has not accepted their organization invitation yet.
   */
  public async isAssignable(repo: string, username: string): Promise<boolean> {
    if (!this.isConfigured()) return false
    try {
      const res = await fetch(
        `${GITHUB_API_BASE}/repos/${repo}/assignees/${encodeURIComponent(username)}`,
        {
          method: 'get',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': GITHUB_API_VERSION,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      // 204 assignable, 404 not. Anything else is a fault, not an answer.
      if (res.status === 204) return true
      if (res.status === 404) return false
      Logger.error(`GitHub Issues: unexpected ${res.status} checking ${username} on ${repo}`)
      return false
    } catch (err: unknown) {
      Logger.error(
        `GitHub Issues: failed to check whether ${username} is assignable on ${repo}: ${describeError(err)}`,
        err,
      )
      return false
    }
  }

  /**
   * Assign `username` to an issue.
   *
   * GitHub silently drops an assignee it will not accept, answering 201 with
   * the user absent from the returned list, so success is decided by reading
   * the response body rather than the status code.
   */
  public async assign(repo: string, issueNumber: number, username: string): Promise<AssignResult> {
    if (!this.isConfigured()) return { status: 'not-configured' }

    const url = `${GITHUB_API_BASE}/repos/${repo}/issues/${issueNumber}/assignees`
    try {
      const res = await fetch(url, {
        method: 'post',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        body: JSON.stringify({ assignees: [username] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const message = `${res.status} ${text}`.trim()
        Logger.error(
          `GitHub Issues: failed to assign ${username} to ${repo}#${issueNumber}: ${message}`,
        )
        return { status: 'error', message }
      }

      const body = (await res.json()) as { assignees?: { login?: unknown }[] }
      const assigned = (body.assignees ?? []).some(
        (assignee) =>
          typeof assignee.login === 'string' &&
          assignee.login.toLowerCase() === username.toLowerCase(),
      )
      if (!assigned) {
        Logger.warn(
          `GitHub Issues: GitHub accepted the request but did not assign ${username} to ${repo}#${issueNumber}`,
        )
        return { status: 'not-assignable' }
      }

      // Drop it from the cache so a concurrent draw cannot offer it again
      // before the next refresh.
      this.issues = this.issues.filter(
        (issue) => !(issue.repo === repo && issue.number === issueNumber),
      )
      return { status: 'assigned' }
    } catch (err: unknown) {
      const message = describeError(err)
      Logger.error(
        `GitHub Issues: request failed assigning ${username} to ${repo}#${issueNumber}: ${message}`,
        err,
      )
      return { status: 'error', message }
    }
  }
}
