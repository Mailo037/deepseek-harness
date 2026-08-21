/**
 * The app-level close grace: when every window is gone, agent work in the
 * host keeps running for a bounded window so a quick reopen resumes without
 * interruption; when the window expires, the host shuts down.
 *
 * Electron-free on purpose: this module is imported by both the Electron
 * main entry and the plain-Node grace test.
 * @module @deepseek-ai/dsh-electron/grace
 */

/** Default grace window in milliseconds. */
export const DEFAULT_GRACE_MS = 5_000

/** What happens when the grace window expires. */
export type GraceExpire = () => void | Promise<void>

/**
 * One-shot close grace. `start()` arms the timer; `cancel()` disarms it
 * without firing; `fire()` expires it immediately. Re-arming replaces the
 * previous timer.
 */
export class GraceTimer {
  private timer: NodeJS.Timeout | undefined
  private readonly expire: GraceExpire

  constructor(expire: GraceExpire) {
    this.expire = expire
  }

  /** Arm the grace for `ms` milliseconds; a pending timer is replaced. */
  start(ms: number): void {
    this.cancel()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.expire()
    }, ms)
  }

  /** Disarm without firing. */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /** Expire now, as if the window had elapsed. */
  fire(): void {
    this.cancel()
    void this.expire()
  }

  /** Whether a timer is currently armed. */
  get pending(): boolean {
    return this.timer !== undefined
  }

  /** Disarm; a disposed timer never fires. */
  dispose(): void {
    this.cancel()
  }
}
