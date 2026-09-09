/**
 * Launch-at-computer-start preference stored in the Host user-settings
 * document. The durable field lives here so Host and browser share one
 * schema; applying the preference is the surface's own job through the
 * `launchSettings` service seam.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the launch-at-login feature. */
export const LAUNCH_SETTINGS_NAMESPACE = 'ui-launch'

/** Field carrying the launch-at-computer-start switch. */
export const LAUNCH_AT_LOGIN_FIELD = 'launchAtLogin'

/**
 * Defaults when the user-settings document has no override. The switch is
 * opt-in: nothing registers a login item the user never asked for.
 */
export const DEFAULT_LAUNCH_SETTINGS: LaunchSettings = {
  launchAtLogin: false,
}

/** Durable launch section shared by the Host schema and the browser scope. */
export interface LaunchSettings {
  /** Register the app with the surface's launch backend so it starts at computer startup. */
  launchAtLogin: boolean
}

/** Durable launch schema; also the wire envelope the browser scope validates against. */
export const LaunchSettingsSchema: z<LaunchSettings> = z.object({
  [LAUNCH_AT_LOGIN_FIELD]: z.boolean().default(false),
})
