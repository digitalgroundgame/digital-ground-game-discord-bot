/** How many pull requests a single `/find-work` run offers for review, on top of the issue draw. */
export const REVIEW_SUGGESTION_LIMIT = 2

/** An open, non-draft pull request as `/find-work` sees it. */
export interface OpenPullRequest {
  /** `owner/name`, as GitHub spells it. */
  repo: string
  number: number
  title: string
  htmlUrl: string
  /** Author login, lowercased. */
  author: string
  /**
   * Lowercased logins already involved as reviewers: requested, or having
   * left a review. GitHub drops a reviewer from the requested list once they
   * review, so both are needed to avoid re-suggesting someone.
   */
  reviewers: string[]
  /** Changed paths that existed before this PR and are not noise (see `isNoiseFile`). */
  files: string[]
  updatedAt: Date
}

/**
 * Who has committed to each file on the default branch, keyed by
 * `fileKey(repo, path)`, mapping lowercased login to commit count.
 */
export type FileAuthorIndex = ReadonlyMap<string, ReadonlyMap<string, number>>

/**
 * Why a pull request was suggested: it changes files the member has
 * committed to (`history`), or it is open in a repository one of their teams
 * reaches (`team`).
 */
export type ReviewSuggestionSource = 'history' | 'team'

/** A pull request suggested for review, with what earned it. */
export interface ReviewSuggestion {
  pr: OpenPullRequest
  source: ReviewSuggestionSource
  /** The PR's files the member has committed to before. Empty for a `team` suggestion. */
  matchedFiles: string[]
  /** The member's commits across `matchedFiles`. */
  commits: number
}

export interface SuggestReviewsOptions {
  /**
   * The member's matched repositories, lowercased `owner/name` (see
   * `GitHubTeamsService.getMemberTeamRepos`). Fills any slot history leaves
   * empty. Omit when the teams couldn't be read, and only history matches are
   * suggested.
   */
  teamRepos?: ReadonlySet<string>
  limit?: number
}

export function fileKey(repo: string, path: string): string {
  return `${repo.toLowerCase()}:${path}`
}

const NOISE_BASENAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
])
const NOISE_DIRS = ['dist/', 'build/', 'node_modules/', 'vendor/', 'coverage/']
const NOISE_SUFFIXES = ['.min.js', '.min.css', '.map', '.snap']

/**
 * Files whose history says nothing about who knows the code: lockfiles,
 * build output, snapshots. Left in, they make everyone who ever bumped a
 * dependency a match for every dependency PR.
 */
export function isNoiseFile(path: string): boolean {
  const lower = path.toLowerCase()
  const basename = lower.slice(lower.lastIndexOf('/') + 1)
  if (NOISE_BASENAMES.has(basename)) return true
  if (NOISE_DIRS.some((dir) => lower.startsWith(dir) || lower.includes(`/${dir}`))) return true
  return NOISE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/**
 * Pull requests to suggest to `login`, in two tiers.
 *
 * History first: open pull requests touching files the member has committed
 * to, best match first — most matched files, then most commits across them,
 * then the PR that has waited longest, the same lean toward neglected work as
 * the wildcard.
 *
 * Any slot left over goes to open pull requests in `teamRepos`, which history
 * alone leaves out: PRs that only add files, and repos the member hasn't
 * committed to yet. Those with no reviewer yet come first, then the
 * longest-waiting.
 *
 * Both tiers leave out the member's own PRs and any they are already
 * reviewing, and no PR is suggested twice. Drafts and bot-authored PRs never
 * reach here (see `toOpenPullRequest`).
 */
export function suggestReviews(
  prs: readonly OpenPullRequest[],
  index: FileAuthorIndex,
  login: string,
  { teamRepos, limit = REVIEW_SUGGESTION_LIMIT }: SuggestReviewsOptions = {},
): ReviewSuggestion[] {
  const me = login.toLowerCase()
  const open = prs.filter((pr) => pr.author !== me && !pr.reviewers.includes(me))

  const history: ReviewSuggestion[] = []
  for (const pr of open) {
    const matchedFiles: string[] = []
    let commits = 0
    for (const path of pr.files) {
      const count = index.get(fileKey(pr.repo, path))?.get(me) ?? 0
      if (count > 0) {
        matchedFiles.push(path)
        commits += count
      }
    }
    if (matchedFiles.length > 0) history.push({ pr, source: 'history', matchedFiles, commits })
  }

  const suggestions = history
    .sort(
      (a, b) =>
        b.matchedFiles.length - a.matchedFiles.length ||
        b.commits - a.commits ||
        a.pr.updatedAt.getTime() - b.pr.updatedAt.getTime(),
    )
    .slice(0, limit)
  if (suggestions.length >= limit || !teamRepos || teamRepos.size === 0) return suggestions

  const taken = new Set(suggestions.map((suggestion) => suggestion.pr))
  const team = open
    .filter((pr) => !taken.has(pr) && teamRepos.has(pr.repo.toLowerCase()))
    .sort(
      (a, b) =>
        Number(a.reviewers.length > 0) - Number(b.reviewers.length > 0) ||
        a.updatedAt.getTime() - b.updatedAt.getTime(),
    )
    .slice(0, limit - suggestions.length)
    .map((pr): ReviewSuggestion => ({ pr, source: 'team', matchedFiles: [], commits: 0 }))

  return [...suggestions, ...team]
}
