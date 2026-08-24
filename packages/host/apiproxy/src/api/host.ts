/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** Repository identity of the host installation, when it runs from a git checkout. */
export interface HostRepository {
  /** Current checked-out branch (`HEAD` when detached). */
  branch: string
  /** Full commit hash at HEAD. */
  commit: string
  /** The origin remote's URL, or a sole other remote's; null when none is configured. */
  remoteUrl: string | null
}

/** Which application surface hosts this API: the dsh CLI's web server or the Electron desktop shell. */
export type HostSurface = 'web' | 'electron'

/** Newest upstream commit, as an update check reports it. */
export interface UpdateLatestCommit {
  /** Full commit hash. */
  commit: string
  /** Single-line subject of the commit message. */
  subject: string
}

/** host.checkUpdate response value: one upstream comparison after a fetch. */
export interface UpdateCheck {
  /** Whether the upstream has commits HEAD lacks. */
  available: boolean
  /** Current checked-out branch (`HEAD` when detached). */
  branch: string
  /** Full commit hash at HEAD when the check ran. */
  commit: string
  /** Tracking ref the comparison ran against, e.g. `origin/master`. */
  upstream: string
  /** Commits the upstream has that HEAD lacks. */
  behind: number
  /** Newest upstream commit; null when up to date or the ref reads empty. */
  latest: UpdateLatestCommit | null
  /** Epoch ms when the underlying fetch completed. */
  checkedAt: number
}

/** host.applyUpdate response value: the update handoff was accepted. */
export interface ApplyUpdateOutcome {
  /** True after quiescence and update-runner preparation complete. */
  started: true
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's version (nearest @deepseek-ai manifest of the running installation);
   * cwd = the host process working directory (root for session persistence and tool execution);
   * provider/model = the defaults applied when a new agent doesn't specify them explicitly, absent
   * when the host configures no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * home = the host account home directory (Web display abbreviation on POSIX);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop;
   * repository = the git working-tree identity behind this installation, null when the host does
   * not run from a checkout (or no self-update provider is composed);
   * canRestart = whether this launcher can replace its own process (`host.applyUpdate` is served);
   * surface = which application surface hosts this API (`web` CLI server or `electron` desktop shell).
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
    repository: HostRepository | null
    canRestart: boolean
    surface: HostSurface
  }>>

  /**
   * Fetch the remotes and compare HEAD against the current branch's upstream.
   * Results are cached briefly per host; `force` re-runs the fetch. Only
   * served under the loopback fence — the check makes the HOST issue network
   * requests and reports its checkout state. Fails with `self-update-unavailable`
   * (no checkout/git), `self-update-no-upstream`, or `self-update-git-failed`.
   */
  checkUpdate(request: RpcRequest<{ force?: boolean }>): Promise<RpcResponse<UpdateCheck>>

  /**
   * Apply an available update: cancel every live agent's active turn (queued
   * work survives in the durable session), wait for them to reach quiescence,
   * and accept a bounded process handoff. The Web launcher starts a detached
   * updater before shutdown; that updater fast-forwards, builds, serves status
   * on the retained port, and starts the same invocation with `--no-open`.
   * Electron keeps its native pull/relaunch path. Only served under the
   * loopback fence. Fails with
   * `self-update-unavailable`, `self-update-no-upstream`,
   * `self-update-not-fast-forward` (a diverged tree refuses), or
   * `restart-unavailable` (this launcher cannot respawn itself).
   */
  applyUpdate(request: RpcRequest<{}>): Promise<RpcResponse<ApplyUpdateOutcome>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>
}
