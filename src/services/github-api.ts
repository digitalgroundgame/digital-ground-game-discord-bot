import fetch from 'node-fetch'

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_API_VERSION = '2022-11-28'
/** Without this a stalled connection never settles, leaving a deferred interaction hanging. */
export const REQUEST_TIMEOUT_MS = 10_000
/** GitHub's maximum. */
export const PAGE_SIZE = 100
/** Bounds the paging loops if GitHub ever stops shrinking the final page. */
export const MAX_PAGES = 10

export function describeError(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') {
    return `no response after ${REQUEST_TIMEOUT_MS}ms`
  }
  return err instanceof Error ? err.message : String(err)
}

export function githubHeaders(token: string | undefined): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
}

/** GET a REST path and return the parsed body, throwing on a non-2xx answer. */
export async function githubGet(token: string | undefined, path: string): Promise<unknown> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: 'get',
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${text}`.trim())
  }
  return res.json()
}

/**
 * Run a GraphQL query and return its `data`. GraphQL answers 200 even when the
 * query failed, so `errors` is checked as well as the status.
 */
export async function githubGraphql(
  token: string | undefined,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${GITHUB_API_BASE}/graphql`, {
    method: 'post',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${text}`.trim())
  }
  const body = (await res.json()) as { data?: unknown; errors?: { message?: unknown }[] }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const messages = body.errors.map((e) => String(e.message)).join('; ')
    throw new Error(`GraphQL: ${messages}`)
  }
  return body.data
}

/**
 * Public, unarchived repositories in the org, as `owner/name`, minus the
 * excluded ones.
 *
 * `type=public` is what keeps private work out of anything built on this. It
 * is enforced here, at the point repositories are enumerated, rather than by a
 * qualifier on a later query — a bug in the latter would expose every private
 * repository in the org at once.
 */
export async function listPublicOrgRepos(
  token: string | undefined,
  org: string,
  excluded: ReadonlySet<string>,
): Promise<string[]> {
  const repos: string[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await githubGet(
      token,
      `/orgs/${encodeURIComponent(org)}/repos?type=public&per_page=${PAGE_SIZE}&page=${page}`,
    )
    if (!Array.isArray(body)) throw new Error('expected an array of repositories')

    for (const entry of body) {
      const repo = entry as { full_name?: unknown; private?: unknown; archived?: unknown }
      if (typeof repo.full_name !== 'string') continue
      // `type=public` should already guarantee this. Check anyway.
      if (repo.private === true) continue
      if (repo.archived === true) continue
      if (excluded.has(repo.full_name.toLowerCase())) continue
      repos.push(repo.full_name)
    }
    if (body.length < PAGE_SIZE) break
  }
  return repos
}
