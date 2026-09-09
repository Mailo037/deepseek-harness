/**
 * Launch-at-computer-start feature, Host half: owns the durable `ui-launch`
 * settings namespace and applies committed changes through the surface's
 * `launchSettings` backend. The backend seam is provided by the hosting
 * surface — the Electron main registers its login-item face, the web bundle's
 * `web-launch-item` row registers a Windows Run-key backend. Where no backend
 * is composed the namespace is not registered and the browser row renders
 * nothing, so a switch that could not act never appears.
 */
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  LAUNCH_SETTINGS_NAMESPACE, LaunchSettingsSchema, type LaunchSettings,
} from './launch-settings.ts'

const LAUNCH_NAMESPACE = settingsNamespace(LAUNCH_SETTINGS_NAMESPACE)

/** The surface-provided launch backend: register or unregister the app's login item. */
export interface LaunchItemBackend {
  /** Whether this surface can apply login-item changes at all. */
  readonly supported: boolean
  /**
   * Apply one preference value. Implementations persist to the OS (registry
   * Run key, LaunchAgent, XDG autostart) — never to the settings document.
   * @param launchAtLogin - whether the app should start at computer startup.
   */
  apply(launchAtLogin: boolean): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The surface's launch backend, when the deployment can act on the preference (read via `ctx.get`, optional by design). */
    launchSettings: LaunchItemBackend
  }
}

/**
 * Register the durable launch section and apply its committed values. The
 * injection waits for the surface's backend, so the provider's activation
 * order never matters: where no backend is ever composed (a macOS or Linux
 * web host) the callback never runs, the namespace stays unregistered, and
 * the browser row renders nothing. The initial apply runs only when the user
 * already overrode the preference, so a never-touched switch cannot clobber
 * an OS-managed login item; a committed change always applies, which also
 * repairs a stale login-item path after an app update.
 * @param ctx - Host context that may acquire the settings and backend services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'launchSettings'], (settingsCtx) => {
    const backend = settingsCtx.get('launchSettings')
    if (backend === undefined || !backend.supported) return
    const scope = settingsCtx.settings.register(LAUNCH_NAMESPACE, LaunchSettingsSchema)
    settingsCtx.effect(() => {
      // Self-contained input already validated by the schema at registration.
      const hasUserOverride = settingsCtx.settings.describe()
        .some(descriptor => descriptor.ns === LAUNCH_NAMESPACE && descriptor.user !== undefined)
      if (hasUserOverride) backend.apply(scope.get().launchAtLogin)
      return scope.watch((next: LaunchSettings) => { backend.apply(next.launchAtLogin) })
    }, 'ui-launch: login-item application')
  })
}
