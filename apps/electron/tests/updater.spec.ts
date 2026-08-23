import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdater, UPDATE_CHECK_INTERVAL_MS, type NativeUpdater, type UpdatePresenter } from '../src/updater.ts'

/** Scriptable electron-updater stand-in; it leaves all visible behavior real. */
class FakeUpdater implements NativeUpdater {
  autoDownload = true
  autoInstallOnAppQuit = true
  checks = 0
  downloads = 0
  installs = 0
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  async checkForUpdates(): Promise<void> { this.checks += 1 }
  async downloadUpdate(): Promise<readonly string[]> { this.downloads += 1; return [] }
  quitAndInstall(): void { this.installs += 1 }
  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
  }
  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
}

/** Capture native-visible state without opening an OS notification in a test. */
function presenter(responses: number[] = []): UpdatePresenter & { notices: string[]; progressValues: number[] } {
  const notices: string[] = []
  const progressValues: number[] = []
  return {
    notices,
    progressValues,
    notify: (_title, body) => { notices.push(body) },
    message: async () => ({ response: responses.shift() ?? 1 }),
    progress: (value) => { progressValues.push(value) },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DesktopUpdater', () => {
  it('checks periodically but never downloads or installs without two user approvals', async () => {
    vi.useFakeTimers()
    const updater = new FakeUpdater()
    const view = presenter([0, 0])
    const subject = new DesktopUpdater(updater, view)

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    subject.start()
    await Promise.resolve()
    expect(updater.checks).toBe(1)

    updater.emit('checking-for-update')
    expect(subject.snapshot.phase).toBe('checking')
    expect(view.notices).toContain('Checking for desktop updates…')
    updater.emit('update-available', { version: '1.2.3' })
    await Promise.resolve()
    expect(updater.downloads).toBe(1)
    expect(subject.snapshot).toEqual({ phase: 'downloading', version: '1.2.3', error: null })

    updater.emit('download-progress', { percent: 45 })
    expect(view.progressValues).toContain(0.45)
    updater.emit('update-downloaded', { version: '1.2.3' })
    await Promise.resolve()
    expect(updater.installs).toBe(1)
    expect(view.progressValues).toContain(-1)

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(updater.checks).toBe(2)
    subject.dispose()
  })

  it('leaves a downloaded installer pending when restart approval is declined', async () => {
    const updater = new FakeUpdater()
    const subject = new DesktopUpdater(updater, presenter([1]))

    updater.emit('update-downloaded', { version: '2.0.0' })
    await Promise.resolve()

    expect(subject.snapshot).toEqual({ phase: 'downloaded', version: '2.0.0', error: null })
    expect(updater.installs).toBe(0)
  })

  it('reports updater failures without attempting an installer fallback', () => {
    const updater = new FakeUpdater()
    const view = presenter()
    const subject = new DesktopUpdater(updater, view)

    updater.emit('error', new Error('offline'))

    expect(subject.snapshot).toEqual({ phase: 'error', version: null, error: 'offline' })
    expect(view.notices).toEqual(['offline'])
    expect(updater.installs).toBe(0)
  })
})
