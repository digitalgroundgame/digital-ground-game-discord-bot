import fetch from 'node-fetch'

import {
  describeError,
  GITHUB_API_BASE,
  githubGet,
  githubGraphql,
  githubHeaders,
  listPublicOrgRepos,
  MAX_PAGES,
  PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
} from './github-api.js'
import { type AssignResult } from './github-issues-service.js'
import { Logger } from './logger.js'
import { GiveIssueExcludedRepos } from '../constants/give-issue.js'
import {
  type FileAuthorIndex,
  fileKey,
  isNoiseFile,
  type OpenPullRequest,
} from '../constants/review-suggestions.js'

/**
 * Paths read per pull request. One page of the files API; a PR touching more
 * than this is rarely one to hand a volunteer anyway, and the first hundred
 * paths are plenty to match on.
 */
const MAX_FILES_PER_PR = 100
/** Paths per GraphQL history query. Each alias costs `HISTORY_DEPTH` nodes. */
const HISTORY_BATCH_SIZE = 20
/**
 * Commits read per file. The most recent fifty say who knows the file *now*;
 * someone who last touched it years ago is a weaker match anyway.
 */
const HISTORY_DEPTH = 50
/** Co-authors read per commit, so `Co-authored-by` trailers count too. */
const AUTHORS_PER_COMMIT = 5

interface RawPull {
  number?: unknown
  title?: unknown
  html_url?: unknown
  updated_at?: unknown
  draft?: unknown
  user?: { login?: unknown } | null
  requested_reviewers?: unknown
}

interface RawPullFile {
  filename?: unknown
  previous_filename?: unknown
  status?: unknown
}

function lowerLogin(user: unknown): string | null {
  const login = (user as { login?: unknown } | null)?.login
  return typeof login === 'string' ? login.toLowerCase() : null
}

/**
 * Convert one pulls-API entry into an open pull request with no files or
 * reviews filled in yet, or null if it should not be offered. Exported for
 * tests.
 */
export function toOpenPullRequest(repo: string, raw: RawPull): OpenPullRequest | null {
  // Drafts are not asking for review yet.
  if (raw.draft === true) return null
  if (typeof raw.number !== 'number' || typeof raw.title !== 'string') return null
  if (typeof raw.html_url !== 'string' || typeof raw.updated_at !== 'string') return null
  const author = lowerLogin(raw.user)
  if (author === null) return null

  const updatedAt = new Date(raw.updated_at)
  if (Number.isNaN(updatedAt.getTime())) return null

  const reviewers = Array.isArray(raw.requested_reviewers)
    ? raw.requested_reviewers.map(lowerLogin).filter((login): login is string => login !== null)
    : []

  return {
    repo,
    number: raw.number,
    title: raw.title,
    htmlUrl: raw.html_url,
    author,
    reviewers,
    files: [],
    updatedAt,
  }
}

/**
 * The paths whose history is worth reading for one changed file, or null.
 *
 * A file the PR adds has no history on the default branch, so it can't match
 * anyone. A renamed file's history lives under its old name.
 */
export function historyPathFor(raw: RawPullFile): string | null {
  if (typeof raw.filename !== 'string') return null
  if (raw.status === 'added') return null
  const path =
    raw.status === 'renamed' && typeof raw.previous_filename === 'string'
      ? raw.previous_filename
      : raw.filename
  return isNoiseFile(path) ? null : path
}

/**
 * Build one GraphQL query reading the recent default-branch history of each
 * path. Paths go in as variables, never into the query text, so a filename
 * cannot change the query's shape.
 */
export function buildHistoryQuery(
  owner: string,
  name: string,
  paths: readonly string[],
): { query: string; variables: Record<string, string> } {
  const variables: Record<string, string> = { owner, name }
  const declarations = ['$owner: String!', '$name: String!']
  const fields: string[] = []
  paths.forEach((path, i) => {
    variables[`p${i}`] = path
    declarations.push(`$p${i}: String!`)
    fields.push(
      `f${i}: history(first: ${HISTORY_DEPTH}, path: $p${i}) { nodes { authors(first: ${AUTHORS_PER_COMMIT}) { nodes { user { login } } } } }`,
    )
  })
  const query = `query(${declarations.join(', ')}) { repository(owner: $owner, name: $name) { defaultBranchRef { target { ... on Commit { ${fields.join(' ')} } } } } }`
  return { query, variables }
}

/**
 * Read a `buildHistoryQuery` answer into login → commit count per path.
 * Commits whose author email isn't tied to a GitHub account have no `user`
 * and are skipped; so are bots, which GraphQL doesn't return as users.
 */
export function parseHistory(
  data: unknown,
  paths: readonly string[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  const target = (
    data as {
      repository?: { defaultBranchRef?: { target?: Record<string, unknown> } | null } | null
    } | null
  )?.repository?.defaultBranchRef?.target
  if (!target) return result

  paths.forEach((path, i) => {
    const history = target[`f${i}`] as { nodes?: unknown } | undefined
    if (!Array.isArray(history?.nodes)) return

    const counts = new Map<string, number>()
    for (const commit of history.nodes) {
      const authors = (commit as { authors?: { nodes?: unknown } }).authors?.nodes
      if (!Array.isArray(authors)) continue
      // One commit counts once per person, however many times they appear on it.
      const logins = new Set<string>()
      for (const author of authors) {
        const login = lowerLogin((author as { user?: unknown }).user)
        if (login !== null) logins.add(login)
      }
      for (const login of logins) counts.set(login, (counts.get(login) ?? 0) + 1)
    }
    if (counts.size > 0) result.set(path, counts)
  })
  return result
}

/**
 * Reads open pull requests from the org's public repositories, works out who
 * has previously committed to the files they change, and requests reviews.
 *
 * All of that is computed by `refresh()` on a schedule and served from
 * memory, the same way `GitHubIssuesService` serves its pool: walking file
 * histories takes far longer than Discord's interaction deadline. The same
 * public-only boundary applies — repositories are enumerated with
 * `type=public` — and the same excluded-repo list.
 *
 * Shares `GITHUB_ISSUES_TOKEN`, which for this needs the repository **Pull
 * requests** permission at read and write on top of what issues need.
 */
export class GitHubPullRequestsService {
  private readonly token: string | undefined
  private readonly org: string | undefined
  private pulls: OpenPullRequest[] = []
  private fileAuthors: FileAuthorIndex = new Map()
  private refreshPromise: Promise<boolean> | null = null

  constructor(token: string | undefined, org: string | undefined) {
    this.token = token?.trim() || undefined
    this.org = org?.trim() || undefined
  }

  /** True when both a token and an organization are set. */
  public isConfigured(): boolean {
    return this.token !== undefined && this.org !== undefined
  }

  /** The pull requests cached by the last successful refresh. */
  public getPullRequests(): readonly OpenPullRequest[] {
    return this.pulls
  }

  /** Who has committed to each file the cached pull requests change. */
  public getFileAuthors(): FileAuthorIndex {
    return this.fileAuthors
  }

  /**
   * Re-read open pull requests and the histories of the files they touch.
   * Returns whether the cache now holds fresh data; a failure keeps the
   * previous data.
   */
  public async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.fetchAll().finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private async listOpenPulls(repo: string): Promise<OpenPullRequest[]> {
    const found: OpenPullRequest[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await githubGet(
        this.token,
        `/repos/${repo}/pulls?state=open&per_page=${PAGE_SIZE}&page=${page}`,
      )
      if (!Array.isArray(body)) throw new Error(`expected an array of pull requests for ${repo}`)
      for (const entry of body) {
        const pr = toOpenPullRequest(repo, entry as RawPull)
        if (pr) found.push(pr)
      }
      if (body.length < PAGE_SIZE) break
    }
    return found
  }

  private async fillFiles(pr: OpenPullRequest): Promise<void> {
    const body = await githubGet(
      this.token,
      `/repos/${pr.repo}/pulls/${pr.number}/files?per_page=${MAX_FILES_PER_PR}`,
    )
    if (!Array.isArray(body))
      throw new Error(`expected an array of files for ${pr.repo}#${pr.number}`)
    const paths = body
      .map((entry) => historyPathFor(entry as RawPullFile))
      .filter((path): path is string => path !== null)
    pr.files = [...new Set(paths)]
  }

  private async fillReviewers(pr: OpenPullRequest): Promise<void> {
    const body = await githubGet(
      this.token,
      `/repos/${pr.repo}/pulls/${pr.number}/reviews?per_page=${PAGE_SIZE}`,
    )
    if (!Array.isArray(body)) return
    const reviewers = new Set(pr.reviewers)
    for (const review of body) {
      const login = lowerLogin((review as { user?: unknown }).user)
      if (login !== null) reviewers.add(login)
    }
    pr.reviewers = [...reviewers]
  }

  private async readHistories(
    repo: string,
    paths: readonly string[],
    into: Map<string, ReadonlyMap<string, number>>,
  ): Promise<void> {
    const [owner, name] = repo.split('/')
    if (!owner || !name) return
    for (let i = 0; i < paths.length; i += HISTORY_BATCH_SIZE) {
      const batch = paths.slice(i, i + HISTORY_BATCH_SIZE)
      const { query, variables } = buildHistoryQuery(owner, name, batch)
      const data = await githubGraphql(this.token, query, variables)
      for (const [path, counts] of parseHistory(data, batch)) {
        into.set(fileKey(repo, path), counts)
      }
    }
  }

  private async fetchAll(): Promise<boolean> {
    if (!this.isConfigured()) return false

    try {
      const repos = await listPublicOrgRepos(this.token, this.org ?? '', GiveIssueExcludedRepos)
      const pulls: OpenPullRequest[] = []
      const fileAuthors = new Map<string, ReadonlyMap<string, number>>()

      // Sequential for the same reason as the issues refresh: GitHub
      // secondary-rate-limits concurrent requests from one token.
      for (const repo of repos) {
        const repoPulls = await this.listOpenPulls(repo)
        const paths = new Set<string>()
        for (const pr of repoPulls) {
          await this.fillFiles(pr)
          await this.fillReviewers(pr)
          for (const path of pr.files) paths.add(path)
        }
        await this.readHistories(repo, [...paths], fileAuthors)
        pulls.push(...repoPulls)
      }

      this.pulls = pulls
      this.fileAuthors = fileAuthors
      Logger.info(
        `GitHub Pull Requests: cached ${pulls.length} open pull request(s) and history for ${fileAuthors.size} file(s) across ${repos.length} public repo(s) in ${this.org}`,
      )
      return true
    } catch (err: unknown) {
      Logger.error(
        `GitHub Pull Requests: failed to refresh for ${this.org}: ${describeError(err)}`,
        err,
      )
      return false
    }
  }

  /**
   * Request a review from `username`.
   *
   * GitHub answers 422 for someone who isn't a collaborator on the repo,
   * which for a public org repo mostly means an unaccepted invitation.
   */
  public async requestReview(
    repo: string,
    pullNumber: number,
    username: string,
  ): Promise<AssignResult> {
    if (!this.isConfigured()) return { status: 'not-configured' }

    const url = `${GITHUB_API_BASE}/repos/${repo}/pulls/${pullNumber}/requested_reviewers`
    try {
      const res = await fetch(url, {
        method: 'post',
        headers: { ...githubHeaders(this.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewers: [username] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (res.status === 422) {
        Logger.warn(
          `GitHub Pull Requests: GitHub would not request a review from ${username} on ${repo}#${pullNumber}`,
        )
        return { status: 'not-assignable' }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const message = `${res.status} ${text}`.trim()
        Logger.error(
          `GitHub Pull Requests: failed to request a review from ${username} on ${repo}#${pullNumber}: ${message}`,
        )
        return { status: 'error', message }
      }

      // Stop suggesting it to them before the next refresh notices.
      const me = username.toLowerCase()
      const pr = this.pulls.find((p) => p.repo === repo && p.number === pullNumber)
      if (pr && !pr.reviewers.includes(me)) pr.reviewers = [...pr.reviewers, me]
      return { status: 'assigned' }
    } catch (err: unknown) {
      const message = describeError(err)
      Logger.error(
        `GitHub Pull Requests: request failed asking ${username} to review ${repo}#${pullNumber}: ${message}`,
        err,
      )
      return { status: 'error', message }
    }
  }
}
