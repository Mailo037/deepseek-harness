/**
 * Electron login-item backend for the launch-at-computer-start preference.
 * The platform decides applicability: Windows registers a registry Run key,
 * packaged macOS apps register a LaunchAgent — a Linux desktop or a
 * non-packaged macOS run reports unsupported so the preference never shows a
 * switch it cannot act on.
 * @module @deepseek-ai/dsh-electron/login-item
 */

import { app } from 'electron'
import type { LaunchItemBackend } from '@deepseek-ai/dsh-client-ui-launch'

/** The Electron surface this backend drives, injectable for tests. */
export interface ElectronAppFace {
  /** Whether this is a packaged application. */
  readonly isPackaged: boolean
  /**
   * Register or unregister the login item.
   * @param settings - Electron login-item options.
   */
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

/**
 * Whether this platform supports login-item registration at all. Windows
 * always does; macOS only for packaged apps (a dev `electron .` run would
 * register the Electron binary itself); Linux has no Electron API support.
 * @param platform - the host platform id.
 * @param isPackaged - whether the app runs packaged.
 * @returns whether `apply` can meaningfully run.
 */
export function loginItemSupported(platform: NodeJS.Platform, isPackaged: boolean): boolean {
  if (platform === 'win32') return true
  return platform === 'darwin' && isPackaged
}

/**
 * Build the launch backend over the Electron app face.
 * @param appFace - the Electron main-process app; injectable for tests.
 * @returns the backend the launch settings namespace applies through.
 */
export function createElectronLaunchItemBackend(appFace: ElectronAppFace = app): LaunchItemBackend {
  const supported = loginItemSupported(process.platform, appFace.isPackaged)
  return {
    supported,
    apply(launchAtLogin: boolean): void {
      if (!supported) return
      appFace.setLoginItemSettings({ openAtLogin: launchAtLogin })
    },
  }
}
