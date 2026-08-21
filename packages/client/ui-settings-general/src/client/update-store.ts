/**
 * State owner for the self-update surface: one snapshot store shared by the
 * sidebar trigger badge and the About settings section. Phases follow the
 * wire flow — check → available/up-to-date → applying → restarting — and end
 * with a page reload onto the restarted host's new build.
 */

import type { HostDescription, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Coarse update-surface phase the UI renders. */
export type UpdatePhase =
  /** No check has completed yet. */
  | 'idle'
  /** A check request is in flight. */
  | 'checking'
  /** The last check found no newer upstream commits. */
  | 'up-to-date'
  /** The last check found newer upstream commits; the apply gesture is live. */
  | 'available'
  /** An apply is quiescing agents and pulling; the restart follows. */
  | 'applying'
  /** The host answered ok and is replacing its process; the page reloads when it returns. */
  | 'restarting'
  /** The last check or apply failed; the stored check result (if any) stays visible. */
  | 'error'

/** Browser state of the update surface. */
export interface UpdateState {
  /** Current phase. */
  phase: UpdatePhase
  /** Last completed check; null before the first success. */
  check: UpdateCheckView | null
  /** Last failure diagnostic; UI copy stays localized beside it. */
  error: string | null
}

/** The part of a wire check the UI renders. */
export interface UpdateCheckView {
  available: boolean
  branch: string
  commit: string
  upstream: string
  behind: number
  latest: { commit: string; subject: string } | null
  checkedAt: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How long after boot the first automatic check waits (let the app settle). */
const FIRST_CHECK_DELAY_MS = 5_000

/** Cadence of automatic background checks. */
const AUTO_CHECK_INTERVAL_MS = 10 * 60_000

/** Poll cadence while waiting for the restarted host to answer again. */
const RESTART_POLL_MS = 1_000

/**
 * Derive the update surface's availability from the shared describe mirror:
 * the plane needs a git repository behind the installation and a launcher
 * that can respawn.
 * @param description - latest connected-generation describe value, if any.
 * @returns whether check/apply can meaningfully run from this client.
 */
export function updatePlaneAvailable(description: HostDescription | undefined): boolean {
  return description !== undefined && description.repository !== null && description.canRestart
}

/** Shared state owner for the trigger badge and the About section. */
export class UpdateStore {
  /** uSES-safe state source shared by every registered consumer. */
  readonly store: SnapshotStore<UpdateState> = createSnapshotStore({
    phase: 'idle', check: null, error: null,
  })

  private autoCheckTimer: ReturnType<typeof setTimeout> | undefined
  private autoCheckInterval: ReturnType<typeof setInterval> | undefined
  private restartPoll: ReturnType<typeof setInterval> | undefined

  /**
   * @param api - loopback-pinned host wire face carrying the update methods.
   */
  constructor(
    private readonly api: Pick<IApiClient, 'host'>,
  ) {}

  /**
   * Run one update check. Concurrent gestures collapse into the in-flight
   * phase; an apply in progress is never interrupted by a check.
   * @param force - bypass the host's result cache.
   */
  async check(force = false): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase === 'checking' || current.phase === 'applying' || current.phase === 'restarting') return
    this.store.update((state) => {
      state.phase = 'checking'
      state.error = null
    })
    try {
      const response = await this.api.host.checkUpdate(force ? { force: true } : {})
      if (!response.result.ok) throw new Error(response.result.error.message)
      const check = response.result.value
      this.store.update((state) => {
        state.check = check
        state.phase = check.available ? 'available' : 'up-to-date'
      })
    } catch (error) {
      // A failed check keeps the last result visible (the badge must not
      // flicker away on one offline poll); without any result it degrades to
      // the error phase.
      this.store.update((state) => {
        state.phase = state.check?.available === true ? 'available' : 'error'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Apply the available update: the host quietsces agents, pulls, answers,
   * and replaces its process; this side watches for the outage-then-return
   * pair and reloads onto the new build.
   */
  async apply(): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.phase !== 'available') return
    this.store.update((state) => {
      state.phase = 'applying'
      state.error = null
    })
    try {
      const response = await this.api.host.applyUpdate({})
      if (!response.result.ok) throw new Error(response.result.error.message)
      this.store.update((state) => {
        state.phase = 'restarting'
      })
      this.watchRestart()
    } catch (error) {
      this.store.update((state) => {
        state.phase = 'available'
        state.error = messageOf(error)
      })
    }
  }

  /**
   * Start the automatic background checks (first one shortly after boot).
   * Idempotent; callers dispose via {@link dispose}.
   */
  startAutoCheck(): void {
    if (this.autoCheckInterval !== undefined) return
    this.autoCheckTimer = setTimeout(() => { void this.check() }, FIRST_CHECK_DELAY_MS)
    this.autoCheckInterval = setInterval(() => { void this.check() }, AUTO_CHECK_INTERVAL_MS)
  }

  /** Stop every timer this store owns. */
  dispose(): void {
    clearTimeout(this.autoCheckTimer)
    clearInterval(this.autoCheckInterval)
    clearInterval(this.restartPoll)
    this.autoCheckTimer = undefined
    this.autoCheckInterval = undefined
    this.restartPoll = undefined
  }

  /**
   * Reload once the restarted host is back: wait for the old process to drop
   * (one failed describe), then reload on the first answer — reloading inside
   * the shutdown window would land on the stale build again.
   */
  private watchRestart(): void {
    if (this.restartPoll !== undefined) return
    let sawOutage = false
    this.restartPoll = setInterval(() => {
      void this.api.host.describe({}).then(
        () => {
          if (!sawOutage) return
          this.dispose()
          location.reload()
        },
        () => { sawOutage = true },
      )
    }, RESTART_POLL_MS)
  }
}
