/**
 * DeepSeek Harness Electron main: boots the same web-profile host as
 * `dsh web` inside the Electron main process, opens the browser UI in a
 * window, and owns the app-level close grace.
 *
 * Lifecycle contract:
 * - The host (agent runtime) lives in the MAIN process, not the renderer.
 *   A renderer crash reloads the window; agent work keeps running.
 * - Closing every window starts a grace timer ({@link DEFAULT_GRACE_MS}).
 *   During the grace the host keeps working. If the app is reopened
 *   (second-instance) within the window, the timer is cancelled and the
 *   window is recreated — no agent work was interrupted. If the window
 *   expires, the host shuts down (sessions flush) and the app quits.
 * - An explicit quit (menu, OS) shuts the host down immediately.
 * @module @deepseek-ai/dsh-electron
 */

import { app, BrowserWindow, shell } from 'electron'
import { bootWebHost, type WebHost } from './host.ts'
import { DEFAULT_GRACE_MS, GraceTimer } from './grace.ts'

/** Window geometry: a sensible desktop default, matching the web surface. */
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800

/** App-level state owned by the main process. */
interface AppState {
  host: WebHost | undefined
  window: BrowserWindow | undefined
  grace: GraceTimer | undefined
  /** True once a shutdown has been requested; prevents double teardown. */
  shuttingDown: boolean
}

const state: AppState = { host: undefined, window: undefined, grace: undefined, shuttingDown: false }

/** Grace window override for tests and tuning (`DSH_ELECTRON_GRACE_MS`). */
function graceMs(): number {
  const raw = process.env.DSH_ELECTRON_GRACE_MS
  if (raw === undefined) return DEFAULT_GRACE_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_GRACE_MS
}

/** Boot the web host, then open the UI window on its URL. */
async function startHost(): Promise<void> {
  state.host = await bootWebHost({
    port: 0,
    onExit: (code) => {
      // The booted app requested exit (e.g. --help). Close cleanly.
      void shutdown(code)
    },
    onRestart: () => {
      // The booted app applied a self-update: schedule Electron's relaunch
      // (re-executes this app with the same arguments after exit), then run
      // the ordinary shutdown so sessions flush before the process ends.
      app.relaunch()
      void shutdown(0)
    },
  })
  createWindow(state.host.url)
}

/** Create (or recreate) the UI window loading the host URL. */
function createWindow(url: string): void {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void window.loadURL(url)
  // The web surface opens external links in the system browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http://') || target.startsWith('https://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  // A renderer crash must not take the agent host down with it: reload the
  // window; agent work in the main process keeps running.
  window.webContents.on('render-process-gone', () => {
    void window.loadURL(url)
  })
  window.on('closed', () => {
    if (state.window === window) state.window = undefined
  })
  // Smoke mode: prove the full Electron path (host boot + window + page
  // load) and exit, so the desktop app is verifiable without a display.
  if (process.env.DSH_ELECTRON_SMOKE === '1') {
    window.webContents.once('did-finish-load', () => {
      console.log(`ELECTRON_WINDOW_READY ${url}`)
      void shutdown(0)
    })
  }
  state.window = window
}

/** Shut the host down (flush sessions) and quit the app with `code`. */
async function shutdown(code = 0): Promise<void> {
  if (state.shuttingDown) return
  state.shuttingDown = true
  state.grace?.dispose()
  state.grace = undefined
  try {
    await state.host?.shutdown()
  } finally {
    state.host = undefined
    app.exit(code)
  }
}

/** All windows are gone: start the close grace instead of quitting. */
function onAllWindowsClosed(): void {
  // macOS keeps the app alive by convention; the grace only applies to
  // platforms where window close normally means app close.
  if (process.platform === 'darwin') return
  state.grace = new GraceTimer(() => {
    state.grace = undefined
    void shutdown(0)
  })
  state.grace.start(graceMs())
}

/** A second app instance appeared: the user reopened the app. Cancel the grace and restore the window. */
function onSecondInstance(): void {
  state.grace?.cancel()
  state.grace = undefined
  if (state.window !== undefined) {
    if (state.window.isMinimized()) state.window.restore()
    state.window.focus()
    return
  }
  if (state.host !== undefined) createWindow(state.host.url)
}

// Single-instance: reopening the app while one runs (even during the grace)
// must land in the existing instance, not spawn a second host.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', onSecondInstance)
  app.on('window-all-closed', onAllWindowsClosed)
  app.on('activate', () => {
    // macOS dock click with no window: recreate the window from the live host.
    if (state.window === undefined && state.host !== undefined) createWindow(state.host.url)
  })
  app.on('before-quit', (event) => {
    // Explicit quit (menu/OS): shut the host down immediately, then quit for real.
    if (!state.shuttingDown) {
      event.preventDefault()
      void shutdown(0)
    }
  })
  void app.whenReady().then(() => startHost()).catch((error) => {
    console.error('dsh-electron: host boot failed:', error)
    void shutdown(1)
  })
}
