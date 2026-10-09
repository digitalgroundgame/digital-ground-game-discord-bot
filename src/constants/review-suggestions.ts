/** How many pull requests a single `/give-issue` run offers for review, on top of the issue draw. */
export const REVIEW_SUGGESTION_LIMIT = 2

/** An open, non-draft pull request as `/give-issue` sees it. */
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

/** A pull request suggested for review, with the files that earned it. */
export interface ReviewSuggestion {
  pr: OpenPullRequest
  /** The PR's files the member has committed to before. */
  matchedFiles: string[]
  /** The member's commits across `matchedFiles`. */
  commits: number
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
 * Open pull requests touching files `login` has committed to, best match
 * first: most matched files, then most commits across them, then the PR that
 * has waited longest — the same lean toward neglected work as the wildcard.
 *
 * Leaves out the member's own PRs and any they are already reviewing.
 */
export function suggestReviews(
  prs: readonly OpenPullRequest[],
  index: FileAuthorIndex,
  login: string,
  limit: number = REVIEW_SUGGESTION_LIMIT,
): ReviewSuggestion[] {
  const me = login.toLowerCase()
  const suggestions: ReviewSuggestion[] = []

  for (const pr of prs) {
    if (pr.author === me || pr.reviewers.includes(me)) continue

    const matchedFiles: string[] = []
    let commits = 0
    for (const path of pr.files) {
      const count = index.get(fileKey(pr.repo, path))?.get(me) ?? 0
      if (count > 0) {
        matchedFiles.push(path)
        commits += count
      }
    }
    if (matchedFiles.length > 0) suggestions.push({ pr, matchedFiles, commits })
  }

  return suggestions
    .sort(
      (a, b) =>
        b.matchedFiles.length - a.matchedFiles.length ||
        b.commits - a.commits ||
        a.pr.updatedAt.getTime() - b.pr.updatedAt.getTime(),
    )
    .slice(0, limit)
}
