/**
 * @deepseek-ai/dsh-host-self-update — the `ctx.selfUpdate` service for a dsh
 * host running from a git checkout: repository identity for the GUI's About
 * surface, upstream update checks, safe agent quiescence, and fast-forward
 * pulls. The restart itself is the launcher's `ctx.appLifecycle.restart` capability —
 * this service only prepares the tree for it.
 *
 * Every git fact is read through one no-shell `git` invocation against the
 * configured working tree; a directory that is not a checkout, or a host
 * without git, degrades to an explicit unavailable capability instead of
 * failing the load (a built installation legitimately has neither). A
 * github.com remote's update check is one public Compare-API request instead
 * of a network git fetch.
 * @module @deepseek-ai/dsh-host-self-update
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: resolves `ctx.agents` (the AgentRegistry Context merge) and the
// live-agent handle quiescence drives.
import type {} from '@deepseek-ai/dsh-agent'
import {
  countBehind, execGit, fetchRemotes, GitError, pullFastForward, readIdentity,
  readLatestCommit, readUpstream,
  type GitCommandRunner, type LatestCommit, type PullOutcome, type RepositoryIdentity,
} from './git.ts'
import { fetchGithubCompare, parseGitHubRepo, type FetchImpl } from './github.ts'

export {
  GitError,
  type GitCommandRunner,
  type GitFailureCode,
  type LatestCommit,
  type PullOutcome,
  type RepositoryIdentity,
} from './git.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    selfUpdate: SelfUpdateService
  }
}

/** Plugin config: where the working tree lives and how long git/network work may take. */
export interface Config {
  /**
   * Absolute git working tree. Empty (the default) searches the nearest
   * ancestor of this package carrying a `.git` entry; a layout without one
   * reports the unavailable capability instead of failing the load.
   * @default '' (auto-detect)
   */
  root: string
  /** Wall-clock bound in ms for one plain git command.
   * @default 10_000 */
  commandTimeoutMs: number
  /** Wall-clock bound in ms for the whole `git fetch` network step.
   * @default 30_000 */
  fetchTimeoutMs: number
  /** How long a check result is served from cache before another fetch runs.
   * @default 60_000 */
  checkCacheMs: number
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  commandTimeoutMs: z.natural().default(10_000),
  fetchTimeoutMs: z.natural().default(30_000),
  checkCacheMs: z.natural().default(60_000),
})

/** Result of one update check. */
export interface UpdateCheck {
  /** Whether the upstream has commits HEAD lacks. */
  available: boolean
  /** Current checked-out branch (`HEAD` when detached). */
  branch: string
  /** Full commit hash at HEAD when the check ran. */
  commit: string
  /**
   * What the comparison ran against: the tracking ref (e.g. `origin/master`),
   * or `owner/repo/branches/branch` when a github.com remote was compared
   * through the public API.
   */
  upstream: string
  /** Commits the upstream has that HEAD lacks. */
  behind: number
  /** Newest upstream commit, null when up to date or the ref reads empty. */
  latest: LatestCommit | null
  /** Epoch ms when the underlying fetch completed. */
  checkedAt: number
}

/** Result of quiescing the live agents before a restart. */
export interface QuiesceResult {
  /** How many live agents received the cancel request. */
  cancelled: number
  /** Whether every agent reached idle inside the bound (false means it expired). */
  drained: boolean
}

/** Network address the detached updater temporarily occupies while rebuilding. */
export interface UpdateWebAddress {
  /** Existing webserver bind host. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Existing webserver's resolved listening port. */
  port: number
}

/** Options narrowing what the detached helper does before relaunching the host. */
export interface UpdateHandoffOptions {
  /**
   * Whether the helper fast-forwards the checkout to its upstream before
   * building. `false` rebuilds the current tree only — the `rebuild_harness`
   * tool's path, where the checkout already carries the wanted sources.
   * @default true
   */
  pull?: boolean
}

/** Detached process handoff accepted structurally by `ctx.appLifecycle.restart`. */
export interface UpdateHandoff {
  /** Current Node executable. */
  command: string
  /** Runner module plus its encoded validated plan. */
  args: readonly string[]
  /** Repository root inherited by the runner. */
  cwd: string
}

/** Where the service's default root search starts: this package's own directory. */
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url))

/** Identity cache lifetime; describe rides every reconnect handshake. */
const IDENTITY_CACHE_MS = 5_000

/** Default whole-drain bound for agent quiescence. */
const QUIESCE_TIMEOUT_MS = 15_000

/** Public issue form used when no github.com remote identity has been cached. */
const DEFAULT_ISSUE_URL = 'https://github.com/deepseek-ai/deepseek-harness/issues/new'

/**
 * Walk up from `start` to the nearest ancestor carrying a `.git` entry.
 * @param start - absolute directory to walk up from.
 * @returns the working-tree root, or null when the filesystem root comes first.
 */
export function detectRepositoryRoot(start: string): string | null {
  let dir = start
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * The self-update service. One instance per context; consumers are the API
 * gateway's host domain methods. All git work goes through the injectable
 * runner seam and a github.com remote's compare request through the
 * injectable fetch seam, so tests script the replies deterministically.
 */
export class SelfUpdateService extends Service {
  static inject = ['agents']

  static Config: z<Config> = Config

  private readonly runner: GitCommandRunner
  private readonly fetchImpl: FetchImpl
  private readonly config: Config
  private readonly root: string | null
  private identityCache: { at: number; value: RepositoryIdentity } | undefined
  private checkCache: { at: number; value: UpdateCheck } | undefined
  /** Serializes mutating git flows (check's fetch and pull) against each other. */
  private gitChain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - host context carrying the agents registry.
   * @param config - validated plugin config; a patch row without a config
   *   block hands `undefined`, and the schema's own defaults are the single
   *   source for the resolved values.
   * @param runner - git runner seam; production uses real `git`.
   * @param fetchImpl - transport seam for the GitHub compare request;
   *   production uses global fetch.
   */
  constructor(
    ctx: Context,
    config: Config,
    runner: GitCommandRunner = execGit,
    fetchImpl: FetchImpl = globalThis.fetch.bind(globalThis),
  ) {
    super(ctx, 'selfUpdate')
    this.runner = runner
    this.fetchImpl = fetchImpl
    this.config = config
    this.root = this.config.root !== '' ? this.config.root : detectRepositoryRoot(PACKAGE_DIR)
  }

  /**
   * Whether this host can serve repository facts and updates at all. The
   * `.git` entry is re-checked per call so an explicit root that stopped
   * being a checkout degrades like an undetectable one.
   * @returns the working-tree root when a checkout was found, else the reason.
   */
  status(): { kind: 'git'; root: string } | { kind: 'unavailable'; reason: string } {
    if (this.root === null || !existsSync(join(this.root, '.git'))) {
      return { kind: 'unavailable', reason: 'no git working tree found above the dsh installation' }
    }
    return { kind: 'git', root: this.root }
  }

  /**
   * Read the repository identity (branch, commit, remote URL), cached briefly
   * because every reconnect handshake's describe carries it.
   * @returns the identity facts, or null when no checkout is configured.
   * @throws {GitError} propagated from the underlying commands.
   */
  async describe(): Promise<RepositoryIdentity | null> {
    const place = this.status()
    if (place.kind !== 'git') return null
    if (this.identityCache !== undefined && Date.now() - this.identityCache.at < IDENTITY_CACHE_MS) {
      return this.identityCache.value
    }
    const value = await readIdentity(place.root, this.runner, this.config.commandTimeoutMs)
    this.identityCache = { at: Date.now(), value }
    return value
  }

  /**
   * Report how far behind the upstream the tree is. A github.com remote is
   * compared with one public Compare-API request (no network git); every
   * other remote fetches through git. Results are cached per
   * {@link Config.checkCacheMs}; `force` bypasses the cache. Concurrent
   * checks share one chain so two clients never race two network steps into
   * one working tree.
   * @param options - `force` skips the cache.
   * @returns the check result.
   * @throws {GitError} propagated from the compare request or the underlying commands.
   */
  check(options?: { force?: boolean }): Promise<UpdateCheck> {
    return this.enqueue(async () => {
      const place = this.assertAvailable()
      const cached = this.checkCache
      if (!options?.force && cached !== undefined
        && Date.now() - cached.at < (this.config.checkCacheMs)) {
        return cached.value
      }
      const [branch, commit] = await Promise.all([
        this.head(place),
        this.commit(place),
      ])
      const identity = await this.describe()
      const remoteUrl = identity?.remoteUrl ?? null
      const slug = remoteUrl === null ? null : parseGitHubRepo(remoteUrl)
      let comparedViaGitHub = false
      let upstream = ''
      let behind = 0
      let latest: LatestCommit | null = null
      if (slug !== null && branch !== 'HEAD') {
        try {
          const compared = await fetchGithubCompare(this.fetchImpl, slug, commit, branch)
          upstream = `${slug.owner}/${slug.repo}/branches/${branch}`
          behind = compared.behind
          latest = compared.latest
          comparedViaGitHub = true
        } catch {
          // GitHub Compare API failed (e.g. HTTP 404 for unpushed local commit, rate limit, private repo).
          // Fall back to git fetch against configured tracking upstream.
        }
      }
      if (!comparedViaGitHub) {
        upstream = await readUpstream(place.root, this.runner, this.config.commandTimeoutMs)
        await fetchRemotes(place.root, this.runner, this.config.fetchTimeoutMs)
        behind = await countBehind(place.root, upstream, this.runner, this.config.commandTimeoutMs)
        latest = behind > 0
          ? await readLatestCommit(place.root, upstream, this.runner, this.config.commandTimeoutMs)
          : null
      }
      const value: UpdateCheck = {
        available: behind > 0,
        branch, commit, upstream, behind, latest,
        checkedAt: Date.now(),
      }
      this.checkCache = { at: value.checkedAt, value }
      return value
    })
  }

  /**
   * Cancel every live agent's active turn (queued inbox work survives for the
   * resumed session) and wait for them to reach quiescence inside a bounded
   * span, so no agent is mid-write when the tree disposes.
   * @param timeoutMs - whole-drain bound; defaults to {@link QUIESCE_TIMEOUT_MS}.
   * @returns the cancel count and whether the drain completed.
   */
  async quiesceAgents(timeoutMs: number = QUIESCE_TIMEOUT_MS): Promise<QuiesceResult> {
    const agents = this.ctx.agents.list()
    for (const agent of agents) agent.cancel({ kind: 'user' }, { keepInbox: true })
    if (agents.length === 0) return { cancelled: 0, drained: true }
    let timer: ReturnType<typeof setTimeout> | undefined
    const drained = await Promise.race([
      Promise.allSettled(agents.map(agent => agent.whenIdle())).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => { resolve(false) }, timeoutMs)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    return { cancelled: agents.length, drained }
  }

  /**
   * Apply an update: fast-forward the current branch to its upstream after a
   * fetch. Serialized with {@link check}; a diverged tree refuses rather than
   * rewriting local history.
   * @returns whether HEAD advanced, with both hashes.
   * @throws {GitError} propagated from the underlying commands.
   */
  pull(): Promise<PullOutcome> {
    return this.enqueue(() => {
      const place = this.assertAvailable()
      return pullFastForward(place.root, this.runner, this.config.fetchTimeoutMs, this.config.commandTimeoutMs)
    })
  }

  /**
   * Build the detached Web update handoff. The helper starts before host
   * shutdown, waits for this process to release the listening port, serves
   * bounded status and command logs there, optionally fast-forwards, builds,
   * then starts this exact Web invocation with the resolved port and
   * `--no-open` forced.
   * @param address - authoritative address of the active Web server.
   * @param options - selects rebuild-only (`pull: false`) over update.
   * @returns the no-shell process request for the launcher.
   * @throws {GitError} when the checkout was not launched through pnpm.
   */
  createWebUpdateHandoff(address: UpdateWebAddress, options: UpdateHandoffOptions = {}): UpdateHandoff {
    const place = this.assertAvailable()
    const pnpmCli = process.env.npm_execpath
    if (pnpmCli === undefined || pnpmCli === '') {
      throw new GitError('git-failed', 'self-update requires a pnpm-launched source checkout')
    }
    const sourceRunner = new URL('./startup.ts', import.meta.url)
    const runner = fileURLToPath(import.meta.url).endsWith('.ts')
      ? fileURLToPath(sourceRunner)
      : fileURLToPath(new URL('./startup.js', import.meta.url))
    const restartArgs = [pnpmCli, 'dsh', ...forceWebRestartArgs(process.argv.slice(2), address.port)]
    const remoteUrl = this.identityCache?.value.remoteUrl
    const github = remoteUrl === undefined || remoteUrl === null ? null : parseGitHubRepo(remoteUrl)
    const plan = {
      version: 1,
      updateId: randomUUID(),
      parentPid: process.pid,
      root: place.root,
      host: address.host,
      port: address.port,
      node: process.execPath,
      pnpmCli,
      restartArgs,
      pull: options.pull ?? true,
      logPath: join(tmpdir(), `dsh-update-${String(process.pid)}.log`),
      issueUrl: github === null
        ? DEFAULT_ISSUE_URL
        : `https://github.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}/issues/new`,
    }
    return {
      command: process.execPath,
      args: [...process.execArgv, runner, Buffer.from(JSON.stringify(plan)).toString('base64url')],
      cwd: place.root,
    }
  }

  /** The validated working tree, or the typed unavailability. */
  private assertAvailable(): { kind: 'git'; root: string } {
    const place = this.status()
    if (place.kind !== 'git') throw new GitError('not-a-repository', place.reason)
    return place
  }

  /** Run one argv against the working tree and trim the reply. */
  private revParse(place: { root: string }, args: readonly string[]): Promise<string> {
    return this.runner(['-C', place.root, ...args], this.config.commandTimeoutMs).then(value => value.trim())
  }

  /** Current branch name; a detached HEAD still names `HEAD`. */
  private head(place: { root: string }): Promise<string> {
    return this.revParse(place, ['rev-parse', '--abbrev-ref', 'HEAD'])
  }

  /** Current full HEAD hash. */
  private commit(place: { root: string }): Promise<string> {
    return this.revParse(place, ['rev-parse', 'HEAD'])
  }

  /** Run one git flow at a time; a failure leaves the chain usable. */
  private enqueue<T>(flow: () => Promise<T>): Promise<T> {
    const next = this.gitChain.then(flow, flow)
    this.gitChain = next.catch(() => undefined)
    return next
  }
}

/**
 * Preserve the current CLI invocation while pinning its resolved Web port and
 * suppressing a second browser handoff.
 * @param args - current Node argv after the executable.
 * @param port - active Web port to retain.
 * @returns argv with one final authoritative port and `--no-open`.
 */
export function forceWebRestartArgs(args: readonly string[], port: number): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index++) {
    const value = args[index] as string
    if (value === '--port') {
      index++
      continue
    }
    if (value.startsWith('--port=') || value === '--no-open') continue
    kept.push(value)
  }
  return [...kept, '--port', String(port), '--no-open']
}

export default SelfUpdateService
