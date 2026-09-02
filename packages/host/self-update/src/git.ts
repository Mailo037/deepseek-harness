/**
 * Git command vocabulary for the self-update service: every repository fact
 * and mutation is one no-shell `git` invocation against the configured
 * working tree, run through the shared native-command runner.
 * @module @deepseek-ai/dsh-host-self-update/git
 */

import { runNativeCommand } from '@deepseek-ai/dsh-native-command'

/** Closed failure vocabulary of the git layer. */
export type GitFailureCode =
  /** The `git` executable is not on PATH. */
  | 'git-unavailable'
  /** The target directory is not inside a git working tree. */
  | 'not-a-repository'
  /** The current branch has no configured upstream. */
  | 'no-upstream'
  /** The upstream moved with history the working tree cannot fast-forward to. */
  | 'not-fast-forward'
  /** Any other git failure; `message` carries the tool's own report. */
  | 'git-failed'

/** Typed git-layer failure so the wire boundary maps business codes without string matching. */
export class GitError extends Error {
  /**
   * @param code - closed failure code.
   * @param message - operator-facing description (includes git's report where one exists).
   */
  constructor(readonly code: GitFailureCode, message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/** Injectable runner seam: production runs real `git`, tests script the replies. */
export type GitCommandRunner = (
  args: readonly string[],
  timeoutMs: number,
) => Promise<string>

/** Child environment for one git run: credential prompts would hang a headless host. */
const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

/**
 * Run one production git command through the shared native-command executor.
 * @param args - git arguments without the executable name.
 * @param timeoutMs - command wall-clock bound.
 */
export const execGit: GitCommandRunner = async (args, timeoutMs) => {
  try {
    const { stdout } = await runNativeCommand('git', [...args], AbortSignal.timeout(timeoutMs), { env: GIT_ENV })
    return stdout
  } catch (error: unknown) {
    throw normalizeGitError(error)
  }
}

/** Map one native-command failure onto the closed git vocabulary. */
function normalizeGitError(error: unknown): GitError {
  const code: unknown = (error as { code?: unknown } | null)?.code
  if (code === 'ENOENT') {
    return new GitError('git-unavailable', 'git is not installed or not on PATH')
  }
  const message = error instanceof Error ? error.message : String(error)
  // exit 128 with this stderr text is git's only "not a work tree" report;
  // matching the message keeps the classification independent of locale.
  const stderr: unknown = (error as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === 'string' && /not a git repository/u.test(stderr)) {
    return new GitError('not-a-repository', message)
  }
  if (/no upstream configured|does not point to a branch|no tracking information/u.test(message)) {
    return new GitError('no-upstream', message)
  }
  if (/not possible to fast-forward|divergent/u.test(message)) {
    return new GitError('not-fast-forward', message)
  }
  return new GitError('git-failed', message)
}

/** Run one git argv in the working tree and return stdout with one trailing newline trimmed. */
async function git(root: string, args: readonly string[], run: GitCommandRunner, timeoutMs: number): Promise<string> {
  const output = await run(['-C', root, ...args], timeoutMs)
  return output.replace(/\r?\n$/u, '')
}

/** Repository identity facts, as the About surface reports them. */
export interface RepositoryIdentity {
  /** Current checked-out branch (`HEAD` when detached). */
  branch: string
  /** Full commit hash at HEAD. */
  commit: string
  /** The origin remote's URL, or a sole other remote's; null when none is configured. */
  remoteUrl: string | null
}

/**
 * Read the working tree's identity: branch, HEAD commit, and remote URL.
 * @param root - absolute git working tree.
 * @param run - runner seam.
 * @param timeoutMs - per-command wall-clock bound.
 * @returns the identity facts.
 * @throws {GitError} propagated from the underlying commands.
 */
export async function readIdentity(root: string, run: GitCommandRunner, timeoutMs: number): Promise<RepositoryIdentity> {
  const [branch, commit] = await Promise.all([
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], run, timeoutMs),
    git(root, ['rev-parse', 'HEAD'], run, timeoutMs),
  ])
  return { branch, commit, remoteUrl: await readRemoteUrl(root, run, timeoutMs) }
}

/** Read the remote URL: origin when present, else the sole remote, else null. */
async function readRemoteUrl(root: string, run: GitCommandRunner, timeoutMs: number): Promise<string | null> {
  const urlOf = async (name: string): Promise<string | null> => {
    const url = await git(root, ['remote', 'get-url', name], run, timeoutMs)
    return url === '' ? null : url
  }
  try {
    return await urlOf('origin')
  } catch (error: unknown) {
    if (!(error instanceof GitError)) throw error
  }
  // No origin is ordinary (a checkout without one); a tree with exactly one
  // other remote still reports it, and anything else reports no URL.
  try {
    const names = (await git(root, ['remote'], run, timeoutMs)).split(/\r?\n/u)
      .filter(name => name !== '')
    if (names.length === 1) return await urlOf(names[0] ?? '')
  } catch (error: unknown) {
    if (!(error instanceof GitError)) throw error
  }
  return null
}

/**
 * Resolve the current branch's upstream (`@{upstream}`).
 * @param root - absolute git working tree.
 * @param run - runner seam.
 * @param timeoutMs - per-command wall-clock bound.
 * @returns the tracking ref name, e.g. `origin/master`.
 * @throws {GitError} `no-upstream` when the branch has none; others propagated.
 */
export async function readUpstream(root: string, run: GitCommandRunner, timeoutMs: number): Promise<string> {
  try {
    const name = await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], run, timeoutMs)
    if (name === '' || name === '@{upstream}') {
      throw new GitError('no-upstream', 'the current branch has no configured upstream')
    }
    return name
  } catch (error: unknown) {
    if (error instanceof GitError) throw error
    throw normalizeGitError(error)
  }
}

/**
 * Contact the remotes (`git fetch`) so ahead/behind answers reflect the server.
 * @param root - absolute git working tree.
 * @param run - runner seam.
 * @param timeoutMs - whole-fetch wall-clock bound.
 * @throws {GitError} propagated from fetch.
 */
export async function fetchRemotes(root: string, run: GitCommandRunner, timeoutMs: number): Promise<void> {
  await git(root, ['fetch'], run, timeoutMs)
}

/**
 * Count commits the upstream has that HEAD lacks.
 * @param root - absolute git working tree.
 * @param upstream - tracking ref name from {@link readUpstream}.
 * @param run - runner seam.
 * @param timeoutMs - per-command wall-clock bound.
 * @returns the behind count.
 * @throws {GitError} propagated from rev-list.
 */
export async function countBehind(
  root: string, upstream: string, run: GitCommandRunner, timeoutMs: number,
): Promise<number> {
  const stdout = await git(root, ['rev-list', '--count', `HEAD..${upstream}`], run, timeoutMs)
  const count = Number.parseInt(stdout.trim(), 10)
  /* v8 ignore next -- git rev-list --count always prints one decimal integer. */
  if (!Number.isFinite(count) || count < 0) throw new GitError('git-failed', `unexpected rev-list output: ${stdout.trim()}`)
  return count
}

/** Newest commit on a ref, split into its hash and subject line. */
export interface LatestCommit {
  /** Full commit hash. */
  commit: string
  /** Single-line subject of the commit message. */
  subject: string
}

/**
 * Read the newest commit on a ref.
 * @param root - absolute git working tree.
 * @param ref - fully qualified ref name.
 * @param run - runner seam.
 * @param timeoutMs - per-command wall-clock bound.
 * @returns the hash and subject, or null when the ref carries no commits.
 * @throws {GitError} propagated from log.
 */
export async function readLatestCommit(
  root: string, ref: string, run: GitCommandRunner, timeoutMs: number,
): Promise<LatestCommit | null> {
  const stdout = await git(root, ['log', '-1', '--format=%H%x00%s', ref], run, timeoutMs)
  if (stdout === '') return null
  const separator = stdout.indexOf('\0')
  /* v8 ignore next -- the %x00 format guarantees one NUL between hash and subject. */
  if (separator === -1) return { commit: stdout, subject: '' }
  return { commit: stdout.slice(0, separator), subject: stdout.slice(separator + 1) }
}

/** Result of one applied update pull. */
export interface PullOutcome {
  /** Whether HEAD moved (false when the tree already sat on the upstream commit). */
  advanced: boolean
  /** HEAD before the merge attempt. */
  previousCommit: string
  /** HEAD after the merge attempt. */
  commit: string
}

/**
 * Fast-forward the current branch to its upstream after a fetch. A diverged
 * tree refuses (`not-fast-forward`) instead of merging or rebasing — a
 * self-update must never rewrite local history.
 * @param root - absolute git working tree.
 * @param run - runner seam.
 * @param fetchTimeoutMs - whole-fetch wall-clock bound.
 * @param commandTimeoutMs - per-command wall-clock bound for everything else.
 * @returns whether HEAD advanced, with both hashes.
 * @throws {GitError} propagated from the underlying commands.
 */
export async function pullFastForward(
  root: string,
  run: GitCommandRunner,
  fetchTimeoutMs: number,
  commandTimeoutMs: number,
): Promise<PullOutcome> {
  const previousCommit = await git(root, ['rev-parse', 'HEAD'], run, commandTimeoutMs)
  const upstream = await readUpstream(root, run, commandTimeoutMs)
  await fetchRemotes(root, run, fetchTimeoutMs)
  try {
    await git(root, ['merge', '--ff-only', upstream], run, commandTimeoutMs)
  } catch (error: unknown) {
    if (error instanceof GitError) throw error
    throw normalizeGitError(error)
  }
  const commit = await git(root, ['rev-parse', 'HEAD'], run, commandTimeoutMs)
  return { advanced: commit !== previousCommit, previousCommit, commit }
}
