/**
 * The Electron app's web-profile boot: the same profile stack `dsh web`
 * boots, composed through `@deepseek-ai/dsh-app-boot` instead of the CLI's
 * launcher. The booted host serves the browser UI on loopback and keeps the
 * agent runtime in the Electron main process, so window and renderer
 * lifecycle never stops agent work directly — the app's shutdown path does.
 *
 * Electron-free on purpose: this module is imported by both the Electron
 * main entry and the plain-Node host smoke test.
 * @module @deepseek-ai/dsh-electron/host
 */

import { existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Diagnostic prefix for boot errors and profile machinery. */
const NAME = 'dsh-electron'

/** Absolute path of this app's package.json, resolved via self-reference so it works in both source and built layouts. */
const _require = createRequire(import.meta.url)
const INSTALL_ANCHOR = _require.resolve('@deepseek-ai/dsh-electron/package.json')

/**
 * Return the physical package manifest used as the profile module-link anchor.
 * Electron resolves JavaScript through `app.asar`, but OS junctions cannot
 * target that virtual archive path; packaged dependencies therefore live in
 * the builder's matching `app.asar.unpacked` tree.
 * @param anchor - resolved application package manifest.
 * @returns the source anchor, or its packaged physical counterpart.
 */
export function physicalInstallAnchor(anchor: string): string {
  const archiveSegment = `${sep}app.asar${sep}`
  if (!anchor.includes(archiveSegment)) return anchor
  const physical = anchor.replace(archiveSegment, `${sep}app.asar.unpacked${sep}`)
  if (!existsSync(physical)) {
    throw new Error(`${NAME}: packaged runtime anchor unavailable: ${physical}`)
  }
  return physical
}

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
const SHIPPED_PRESET_ROOT = join(dirname(INSTALL_ANCHOR), 'config', 'agent-presets')

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`). */
function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/**
 * Resolve the telemetry opt-out switch into its boot patch, mirroring the
 * CLI launcher's switch semantics.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** Options for {@link bootWebHost}. */
export interface BootWebHostOptions {
  /**
   * Listen port; `0` asks the OS for a free one. Defaults to `0` so the
   * desktop app never collides with a `dsh web` instance on 3080.
   */
  port?: number
  /** Called when a booted app requests exit (for example `--help`). */
  onExit?: (code: number) => void
  /**
   * Called when a booted app requests process replacement (`ctx.appLifecycle.restart`,
   * the self-update flow): the implementation schedules Electron's relaunch
   * and then shuts the host down, so the app re-executes into the updated
   * code. Absent, `ctx.appLifecycle.restart` stays unavailable and the GUI reports the
   * restart capability as unavailable.
   */
  onRestart?: () => void
}

/** A booted web host owned by the caller: the settled tree and its URL. */
export interface WebHost {
  /** The settled root context; `shutdown()` disposes it. */
  ctx: Context
  /** The loopback URL of the served browser UI. */
  url: string
  /** Dispose the tree (flushes session persistence) and drop the server. */
  shutdown(): Promise<void>
}

/**
 * Load the `web` profile and boot it end to end: heal the profiles module
 * fallback, compose the patch stack (bundle layers, profile layer, home
 * layer, app overlays), and settle the tree. The webserver row binds during
 * settlement, so the caller reads the final URL from the returned host.
 * @param options - port and exit callback.
 * @returns the settled root context and its URL.
 */
export async function bootWebHost(options: BootWebHostOptions = {}): Promise<WebHost> {
  const environment = loadLayeredEnv(NAME)
  healProfilesModuleFallback(physicalInstallAnchor(INSTALL_ANCHOR))
  const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR)
  // The root is always rewritten: the whole composition is patch layers, and
  // the vendored Loader's tree write-back can bake composed rows into this
  // file. The file exists on disk only because the Loader needs a real
  // include root to anchor `baseUrl` at the profile directory.
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)

  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays: PatchOptions[] = []
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlays.push(telemetryPatch)

  const port = options.port ?? 0
  const args = ['--no-open', '--port', String(port)]
  const app: { current?: Context } = {}
  const ctx = await boot(NAME, join(profile.dir, PROFILE_ROOT_FILENAME), structuredClone([
    ...bundlePatches,
    ...profile.patches,
    ...homePatches,
    ...overlays,
  ]), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, {
      args,
      exit: code => options.onExit?.(code),
      ...(options.onRestart === undefined ? {} : { restart: options.onRestart }),
    })
  })
  app.current = ctx

  // Config-only HMR for the live profile patch layer: the web bundle disables
  // the shared module-reload `hmr` row, so when the composition leaves no HMR
  // service, mount a watch-only instance with no module roots.
  if (ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined && ctx.get('hmr') === undefined) {
    if (ctx.get('timer') === undefined) {
      await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
    }
    await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
  }
  await watchUserPatches(ctx, {
    binName: NAME,
    filename: profile.patchPath,
    compose: () => structuredClone([...bundlePatches, ...loadOptionalPatches(NAME, profile.patchPath) ?? [], ...homePatches, ...overlays]),
  })
  await watchUserPatches(ctx, {
    binName: NAME,
    filename: homePatchPath(),
    compose: () => structuredClone([...bundlePatches, ...loadOptionalPatches(NAME, profile.patchPath) ?? [], ...homePatches, ...overlays]),
  })

  const webserver = ctx.get('webServer')
  if (webserver === undefined) throw new Error(`${NAME}: webServer service unavailable after boot`)
  const url = `http://127.0.0.1:${String(webserver.port)}`
  let disposed = false
  return {
    ctx,
    url,
    shutdown: async () => {
      if (disposed) return
      disposed = true
      await ctx.fiber.dispose()
    },
  }
}
