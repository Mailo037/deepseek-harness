/**
 * The web surface's launch-at-computer-start backend: on Windows it applies
 * the launch preference to a per-user registry Run key (`HKCU\...\Run`, value
 * `DeepSeekHarness`) whose command relaunches this installation's web host
 * from its checkout root. Non-Windows web hosts provide nothing, so the
 * ui-launch Host half never registers its namespace and the settings row
 * stays hidden there — packaged desktop apps own those platforms' login
 * items instead.
 * @module @deepseek-ai/dsh-web-app/launch-item
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { LaunchItemBackend } from '@deepseek-ai/dsh-client-ui-launch'

/** Stable Cordis plugin name. */
export const name = 'web-launch-item'

/** The per-user autorun key Windows executes at logon; no elevation required. */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

/** The registry value name this installation owns inside {@link RUN_KEY}. */
const VALUE_NAME = 'DeepSeekHarness'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** The registry write this backend shells out to; injectable for tests. */
export type RegistryRun = (file: string, args: readonly string[]) => void

function defaultRegistryRun(file: string, args: readonly string[]): void {
  execFileSync(file, args, { windowsHide: true, timeout: 10_000, stdio: 'ignore' })
}

/** Injectable facts for {@link createWindowsRunKeyBackend}. */
export interface WindowsRunKeyOptions {
  /** Host platform; defaults to the running process. */
  platform?: NodeJS.Platform
  /** The registry command runner; defaults to a bounded, window-less `reg.exe`. */
  run?: RegistryRun
  /** The installation root the relaunch command returns to; defaults to this checkout. */
  root?: string
}

/**
 * Build the Windows Run-key backend. The registered command changes into the
 * installation root and runs the web profile headlessly through pnpm, so a
 * relaunch reproduces the user's home-layer patch (bind host, trusted hosts,
 * port) without this backend knowing those values.
 * @param options - platform, registry runner, and root overrides (tests).
 * @returns the backend the ui-launch Host half applies committed values through.
 */
export function createWindowsRunKeyBackend(options: WindowsRunKeyOptions = {}): LaunchItemBackend {
  const platform = options.platform ?? process.platform
  const run = options.run ?? defaultRegistryRun
  const root = options.root ?? SOURCE_ROOT
  return {
    supported: platform === 'win32',
    apply(launchAtLogin: boolean): void {
      if (platform !== 'win32') return
      if (launchAtLogin) {
        const command = `cmd.exe /d /s /c "cd /d ${root} && pnpm dsh --profile web --no-open"`
        run('reg', ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'])
        return
      }
      // reg.exe cannot report absence portably across locales, so ensure-absent
      // queries first: a failed query means the value is already gone.
      try {
        run('reg', ['query', RUN_KEY, '/v', VALUE_NAME])
      } catch {
        return
      }
      run('reg', ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'])
    },
  }
}

/**
 * Provide the backend on Windows. Everywhere else the plugin installs nothing,
 * so a platform without a launch mechanism renders no switch instead of a
 * dead one.
 * @param ctx - plugin context the launch backend is provided onto.
 */
export function apply(ctx: Context): void {
  if (process.platform !== 'win32') return
  ctx.provide('launchSettings', createWindowsRunKeyBackend())
}
