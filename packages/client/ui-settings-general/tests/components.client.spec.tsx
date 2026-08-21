// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { AboutSection } from '../src/client/AboutSection.tsx'
import type { AboutSectionProps } from '../src/client/AboutSection.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'
import { UpdateStore } from '../src/client/update-store.ts'

/** Store over a real mirror derived from the same fake wire. */
function derivedDocumentStore(api: object) {
  const wire = api as never
  return new SettingsDocumentStore(wire, new SettingsDescribeMirror(wire))
}
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain, including
// the {name} template interpolation.
const t: TriggerContentProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return template.replace(/\{(\w+)\}/gu, (_match, name: string) =>
    params !== undefined && name in params ? String(params[name]) : `{${name}}`)
}

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

/** One idle UpdateStore over a silent wire, bound for component props. */
function idleUpdate() {
  const controller = new UpdateStore({ host: {} } as never)
  return { controller, useSnapshot: bindSnapshotSelector(controller.store) }
}

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const update = idleUpdate()
    const { container } = render(<TriggerContent {...kit} wide t={t} {...update} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const update = idleUpdate()
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} {...update} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('TriggerContent draws the update badge while an update is available', () => {
    const available = idleUpdate()
    available.controller.store.update((state) => { state.phase = 'available' })
    const first = render(<TriggerContent {...kit} wide={false} t={t} {...available} />)
    expect(screen.getByRole('status', { name: 'Update available' })).toBeTruthy()
    // The badge is the only absolutely-positioned dot the trigger adds.
    expect(first.container.querySelector('[role="status"]')?.className).not.toBe('')
    first.unmount()

    const settled = idleUpdate()
    settled.controller.store.update((state) => { state.phase = 'up-to-date' })
    render(<TriggerContent {...kit} wide={false} t={t} {...settled} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      rpcId: 'document-open' as never,
      result: { ok: true as const, value: { opened: true as const } },
    }))
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith({}) })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'document-action-absent' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } },
      })
      .mockResolvedValueOnce({
        rpcId: 'document-action-ready' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
      })
    const wire = { settings: { describe, openDocument: vi.fn() } } as never
    const mirror = new SettingsDescribeMirror(wire)
    const controller = new SettingsDocumentStore(wire, mirror)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument: vi.fn(() => Promise.resolve({
          rpcId: 'document-open-failed' as never,
          result: { ok: false as const, error: { code: 'internal' as const, message: 'xdg-open missing', details: {} } },
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})

/** The connected-generation describe value the About section renders from. */
function description(overrides?: Partial<{
  version: string
  surface: 'web' | 'electron'
  repository: { branch: string; commit: string; remoteUrl: string | null } | null
  canRestart: boolean
}>) {
  return {
    version: '0.1.0-rc.8',
    cwd: '/repo',
    attachedSessions: 0,
    home: '/home',
    canOpenPath: true,
    repository: { branch: 'master', commit: 'a'.repeat(40), remoteUrl: null },
    canRestart: true,
    surface: 'web' as const,
    ...overrides,
  }
}

/** An observable source over one fixed (or mutable) describe snapshot. */
function describeSource(initial: ReturnType<typeof description> | undefined) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next: ReturnType<typeof description> | undefined): void {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('AboutSection', () => {
  function mount(
    source: ReturnType<typeof describeSource>,
    controller: UpdateStore,
  ) {
    const props = {
      ...kit,
      t,
      close: vi.fn(),
      controller,
      useDescribe: bindSnapshotSelector(source),
      useSnapshot: bindSnapshotSelector(controller.store),
    } as never as AboutSectionProps
    return render(<AboutSection {...props} />)
  }

  it('renders identity rows from the describe mirror', () => {
    const source = describeSource(description())
    const update = idleUpdate()
    mount(source, update.controller)
    expect(screen.getByText('0.1.0-rc.8')).toBeTruthy()
    expect(screen.getByText('master')).toBeTruthy()
    expect(screen.getByText('Web')).toBeTruthy()
    // Short commit hash and a live Check control.
    expect(screen.getByText('aaaaaaa')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('waits in the offline note until a generation connects', () => {
    const source = describeSource(undefined)
    const update = idleUpdate()
    mount(source, update.controller)
    expect(screen.getByText('Waiting for the server connection…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('hides update controls without a checkout or restart capability', () => {
    const noRepo = describeSource(description({ repository: null }))
    mount(noRepo, idleUpdate().controller)
    expect(screen.getByText(/does not run from a Git checkout/)).toBeTruthy()

    const noRestart = describeSource(description({ canRestart: false }))
    mount(noRestart, idleUpdate().controller)
    expect(screen.getByText('This launcher cannot restart itself automatically.')).toBeTruthy()
  })

  it('shows the behind count and drives check and apply through the store', async () => {
    const checkUpdate = vi.fn((_request: { force?: boolean }) => Promise.resolve({
      rpcId: 'about-check' as never,
      result: {
        ok: true as const,
        value: {
          available: true, branch: 'master', commit: 'a'.repeat(40),
          upstream: 'origin/master', behind: 3,
          latest: { commit: 'b'.repeat(40), subject: 'feat: newer' }, checkedAt: 1,
        },
      },
    }))
    const applyUpdate = vi.fn(() => Promise.resolve({
      rpcId: 'about-apply' as never,
      result: { ok: true as const, value: { advanced: true, previousCommit: 'a'.repeat(40), commit: 'b'.repeat(40) } },
    }))
    const controller = new UpdateStore({ host: { checkUpdate, applyUpdate } } as never)
    const source = describeSource(description())
    mount(source, controller)

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => { expect(checkUpdate).toHaveBeenCalledWith({ force: true }) })
    // The available phase shows the behind count, the newest subject, and the apply gesture.
    expect(await screen.findByRole('button', { name: 'Update and restart' })).toBeTruthy()
    expect(document.body.textContent).toContain('3 commits behind')
    expect(document.body.textContent).toContain('feat: newer')
    expect(checkUpdate.mock.calls[0]!.length).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }))
    await waitFor(() => { expect(applyUpdate).toHaveBeenCalledWith({}) })
    expect(await screen.findByText(/page will refresh automatically/)).toBeTruthy()
    // While restarting, the apply gesture is gone and checks are disabled.
    expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull()
  })

  it('reports a failed check without losing the section', async () => {
    const controller = new UpdateStore({
      host: {
        checkUpdate: vi.fn(() => Promise.resolve({
          rpcId: 'about-check-failed' as never,
          result: {
            ok: false as const,
            error: { code: 'self-update-no-upstream' as const, message: 'no upstream configured', details: {} },
          },
        })),
        applyUpdate: vi.fn(),
      },
    } as never)
    mount(describeSource(description()), controller)
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check for updates' }).getAttribute('disabled')).toBeNull()
  })
})
