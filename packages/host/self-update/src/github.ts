/**
 * GitHub-backed update check: when the working tree's remote points at
 * github.com, the upstream comparison is one public Compare-API request —
 * no `git fetch` against the network, and a precise behind count from the
 * server. Non-GitHub remotes fall back to the git-fetch path in the service.
 * @module @deepseek-ai/dsh-host-self-update/github
 */

import type { GitCommandRunner } from './git.ts'
import { GitError } from './git.ts'

/** The owner/repo slug of a github.com remote, parsed from its URL. */
export interface GitHubRepo {
  owner: string
  repo: string
}

/**
 * Parse the owner/repo slug out of a remote URL (https or ssh form).
 * @param url - the remote URL as `git remote get-url` reports it.
 * @returns the slug, or null when the remote is not github.com.
 */
export function parseGitHubRepo(url: string): GitHubRepo | null {
  const trimmed = url.trim()
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u.exec(trimmed)
  if (ssh !== null) {
    const [, owner = '', repo = ''] = ssh
    return { owner, repo }
  }
  try {
    const parsed = new URL(trimmed)
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null
    const segments = parsed.pathname.split('/').filter(segment => segment !== '')
    if (segments.length < 2) return null
    const [owner = '', second = ''] = segments
    return { owner, repo: second.replace(/\.git$/u, '') }
  } catch {
    return null
  }
}

/** The part of a Compare-API reply the check reads. */
export interface GitHubCompare {
  /** Commits the head (upstream branch) has that the base (local HEAD) lacks. */
  ahead_by: number
  /** The comparison's commits, oldest first; truncated at very large ranges. */
  commits: { sha: string; commit: { message: string } }[]
}

/** Injectable transport seam; production uses global fetch. */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

/** One wall-clock bound for the API request. */
const GITHUB_TIMEOUT_MS = 15_000

/** GitHub's API rejects requests without a User-Agent. */
const REQUEST_HEADERS = { 'user-agent': 'dsh-self-update', accept: 'application/vnd.github+json' }

/**
 * Ask the GitHub Compare API how far `branch` (the remote tip) has moved past
 * local HEAD.
 * @param fetchImpl - transport seam.
 * @param repo - the parsed owner/repo slug.
 * @param head - local full HEAD hash.
 * @param branch - the remote branch name (e.g. `master`).
 * @param apiBase - the API root; overridable for tests.
 * @returns the behind count and the newest upstream commit.
 * @throws {GitError} `git-failed` with the HTTP status on any failure.
 */
export async function fetchGithubCompare(
  fetchImpl: FetchImpl,
  repo: GitHubRepo,
  head: string,
  branch: string,
  apiBase = 'https://api.github.com',
): Promise<{ behind: number; latest: { commit: string; subject: string } | null }> {
  let response: Response
  try {
    response = await fetchImpl(`${apiBase}/repos/${repo.owner}/${repo.repo}/compare/${head}...${encodeURIComponent(branch)}`, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    throw new GitError('git-failed', `GitHub compare request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new GitError('git-failed', `GitHub compare answered HTTP ${String(response.status)}`)
  }
  const payload = await response.json() as GitHubCompare
  const tip = payload.commits.at(-1)
  return {
    behind: payload.ahead_by,
    latest: tip === undefined ? null : { commit: tip.sha, subject: tip.commit.message.split(/\r?\n/u)[0] ?? '' },
  }
}

/**
 * Read the current branch's plain name from the runner (`master`, not
 * `origin/master`) — the Compare API wants the bare ref.
 * @param root - absolute git working tree.
 * @param run - runner seam.
 * @param timeoutMs - per-command wall-clock bound.
 */
export function readShortBranch(root: string, run: GitCommandRunner, timeoutMs: number): Promise<string> {
  return run(['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], timeoutMs).then(value => value.trim())
}
