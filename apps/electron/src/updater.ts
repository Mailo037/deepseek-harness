/**
 * Native desktop-update orchestration for installed Electron packages. The
 * checkout updater remains a separate host capability: this module only
 * handles signed electron-builder release artifacts and never edits a Git
 * worktree.
 * @module @deepseek-ai/dsh-electron/updater
 */

import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { Notification, dialog } from 'electron'
import electronUpdater from 'electron-updater'

/** Six-hour cadence after the first installed-app check. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

/** Minimal updater face so lifecycle tests stay deterministic and keyless. */
export interface NativeUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<readonly string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** Native notifications and dialogs, supplied separately from updater I/O. */
export interface UpdatePresenter {
  notify(title: string, body: string): void
  message(options: MessageBoxOptions): Promise<{ response: number }>
  progress(value: number): void
}

/** Message and progress state kept in the Electron main process. */
type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'

/** Result exposed to the main entry for testable phase observation. */
export interface DesktopUpdateState {
  phase: UpdatePhase
  version: string | null
  error: string | null
}

/** One installed-app updater, including its periodic check timer. */
export class DesktopUpdater {
  private checkTimer: ReturnType<typeof setInterval> | undefined
  private state: DesktopUpdateState = { phase: 'idle', version: null, error: null }

  /**
   * @param updater - electron-updater's installed-artifact updater.
   * @param presenter - native notification, dialog, and progress presenter.
   */
  constructor(
    private readonly updater: NativeUpdater,
    private readonly presenter: UpdatePresenter,
  ) {
    this.updater.autoDownload = false
    // A downloaded installer remains pending until the user chooses restart.
    this.updater.autoInstallOnAppQuit = false
    this.updater.on('checking-for-update', () => { this.onChecking() })
    this.updater.on('update-available', (info) => { this.onAvailable(readVersion(info)) })
    this.updater.on('update-not-available', () => { this.onNotAvailable() })
    this.updater.on('download-progress', (progress) => { this.onProgress(readPercent(progress)) })
    this.updater.on('update-downloaded', (info) => { this.onDownloaded(readVersion(info)) })
    this.updater.on('error', (error) => { this.onError(error) })
  }

  /** Current visible update phase. */
  get snapshot(): Readonly<DesktopUpdateState> {
    return this.state
  }

  /** Start the immediate and periodic installed-artifact checks. */
  start(): void {
    if (this.checkTimer !== undefined) return
    void this.check()
    this.checkTimer = setInterval(() => { void this.check() }, UPDATE_CHECK_INTERVAL_MS)
  }

  /** Stop periodic checks and clear native progress on shutdown. */
  dispose(): void {
    clearInterval(this.checkTimer)
    this.checkTimer = undefined
    this.presenter.progress(-1)
  }

  /** Ask the configured update provider for a newer signed artifact. */
  async check(): Promise<void> {
    if (this.state.phase === 'checking' || this.state.phase === 'downloading') return
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.onError(error)
    }
  }

  /** Display the checking state as a native notification. */
  private onChecking(): void {
    this.state = { phase: 'checking', version: null, error: null }
    this.presenter.notify('DeepSeek Harness', 'Checking for desktop updates…')
  }

  /** Offer download; the update is not transferred until the user chooses it. */
  private onAvailable(version: string): void {
    this.state = { phase: 'available', version, error: null }
    this.presenter.notify('DeepSeek Harness', `Version ${version} is available.`)
    void this.presenter.message({
      type: 'info',
      title: 'Update available',
      message: `DeepSeek Harness ${version} is ready to download.`,
      detail: 'Download the signed installer now. Installation will still require a separate restart confirmation.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response !== 0 || this.state.phase !== 'available') return
      this.state = { phase: 'downloading', version, error: null }
      this.presenter.notify('DeepSeek Harness', `Downloading version ${version}…`)
      void this.updater.downloadUpdate().catch((error: unknown) => { this.onError(error) })
    }).catch((error: unknown) => { this.onError(error) })
  }

  /** Record a clean no-update check without interrupting the user. */
  private onNotAvailable(): void {
    this.state = { phase: 'idle', version: null, error: null }
  }

  /** Reflect updater transfer progress in the current desktop window. */
  private onProgress(percent: number): void {
    this.presenter.progress(percent / 100)
  }

  /** Offer restart only after the complete installer has downloaded. */
  private onDownloaded(version: string): void {
    this.presenter.progress(-1)
    this.state = { phase: 'downloaded', version, error: null }
    this.presenter.notify('DeepSeek Harness', `Version ${version} is ready to install.`)
    void this.presenter.message({
      type: 'info',
      title: 'Update ready',
      message: `DeepSeek Harness ${version} has downloaded.`,
      detail: 'Restart and install closes the current app after its host shuts down cleanly.',
      buttons: ['Restart and install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0 && this.state.phase === 'downloaded') this.updater.quitAndInstall()
    }).catch((error: unknown) => { this.onError(error) })
  }

  /** Report updater failures without attempting a fallback installer or restart. */
  private onError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.presenter.progress(-1)
    this.state = { phase: 'error', version: null, error: message }
    this.presenter.notify('DeepSeek Harness update failed', message)
  }
}

/** Read an update version from electron-updater's event payload. */
function readVersion(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'version' in value && typeof value.version === 'string') {
    return value.version
  }
  return 'a new version'
}

/** Clamp an updater progress payload to Electron's progress-bar range. */
function readPercent(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'percent' in value && typeof value.percent === 'number') {
    return Math.max(0, Math.min(100, value.percent))
  }
  return 0
}

/** Build the production presenter around the current main-process window. */
export function createDesktopUpdater(window: () => BrowserWindow | undefined): DesktopUpdater {
  return new DesktopUpdater(electronUpdater.autoUpdater, {
    notify: (title, body) => { new Notification({ title, body }).show() },
    message: (options) => {
      const owner = window()
      return owner === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(owner, options)
    },
    progress: value => window()?.setProgressBar(value),
  })
}
