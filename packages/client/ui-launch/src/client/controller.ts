/**
 * LaunchSettingsController: the browser-side owner of the launch-at-login
 * preference surface. Reads and writes go through the Host-backed settings
 * scope (the same transport every preference row binds); the snapshot also
 * mirrors the scope's availability so the row renders nothing where the Host
 * composed no `ui-launch` namespace. At most one write is in flight; a newer
 * gesture replaces the pending value and the row shows the scope's accepted
 * state afterwards.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_LAUNCH_SETTINGS, LAUNCH_AT_LOGIN_FIELD, type LaunchSettings,
} from '../launch-settings.ts'

/** Immutable UI state published on every scope change. */
export interface LaunchSnapshot {
  /** Whether the switch is on (the accepted durable value). */
  launchAtLogin: boolean
  /** Whether the Host serves the `ui-launch` namespace (no Host section ⇒ hidden row). */
  available: boolean
  /** Whether writes can persist (remote browsers stay process-local). */
  writable: boolean
  /** Monotonic change counter (local writes and Host adoptions). */
  revision: number
}

/**
 * Preference owner for the launch-at-login row. Writes only through
 * {@link setLaunchAtLogin}; continuous sync only through adoption of the
 * settings scope.
 */
export class LaunchSettingsController {
  private launchAtLogin = DEFAULT_LAUNCH_SETTINGS.launchAtLogin
  private available = false
  private writable = false
  private revision = 0
  private snapshot: LaunchSnapshot = { launchAtLogin: false, available: false, writable: false, revision: 0 }

  /**
   * @param ctx - owning context (change events are emitted on it).
   * @param host - durable preference scope owned by the same plugin.
   */
  constructor(
    private readonly ctx: Context,
    private readonly host: SettingsScope<LaunchSettings>,
  ) {
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-launch: settings scope adoption')
    this.adopt()
  }

  /**
   * Read the current immutable UI snapshot.
   * @returns current launch preference state.
   */
  getSnapshot(): LaunchSnapshot {
    return this.snapshot
  }

  /**
   * Switch launch-at-login — the only write entry.
   * @param launchAtLogin - whether the app should start at computer startup.
   */
  setLaunchAtLogin(launchAtLogin: boolean): void {
    if (this.launchAtLogin === launchAtLogin) return
    this.launchAtLogin = launchAtLogin
    void this.host.set(LAUNCH_AT_LOGIN_FIELD, launchAtLogin)
    this.publish()
  }

  /** Adopt the scope's accepted durable section without writing it back. */
  private adopt(): void {
    const snap: SettingsScopeSnapshot<LaunchSettings> = this.host.getSnapshot()
    this.available = snap.status === 'ready' && snap.value !== undefined
    this.writable = snap.writable
    if (snap.value !== undefined) this.launchAtLogin = snap.value.launchAtLogin
    this.publish()
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = {
      launchAtLogin: this.launchAtLogin,
      available: this.available,
      writable: this.writable,
      revision: this.revision,
    }
    this.ctx.emit('launch/change', this.snapshot)
  }
}
