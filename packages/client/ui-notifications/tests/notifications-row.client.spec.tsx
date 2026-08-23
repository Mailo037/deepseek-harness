// @vitest-environment jsdom
/** NotificationsRow behavior: master switch gates the event pickers, chip
 * selection follows the store mirror, clicks drive the injected face. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  createSnapshotStore, type SessionListState, type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/notification-settings.ts'
import { NotificationsRow } from '../src/client/NotificationsRow.tsx'
import type { NotificationsRowComponentProps } from '../src/client/NotificationsRow.tsx'
import { createNotificationsRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'notifications.title': 'Notification sounds',
  'notifications.enable': 'Play a sound when work finishes or needs you',
  'notifications.event.done': 'Work finished',
  'notifications.event.attention': 'Needs your attention',
  'notifications.event.error': 'Error occurred',
  'notifications.sound.chime': 'Chime',
  'notifications.sound.ping': 'Ping',
  'notifications.sound.bell': 'Bell',
  'notifications.sound.pulse': 'Pulse',
  'notifications.preview': 'Preview',
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(enabled: boolean) {
  const store = createNotificationsRowStore().create()
  act(() => {
    store.actions.sync({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled, doneSound: 'bell', revision: 0 })
  })
  const setEnabled = vi.fn()
  const setSound = vi.fn()
  const preview = vi.fn()
  const props: NotificationsRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setEnabled,
    setSound,
    preview,
  }
  render(<NotificationsRow {...props} />)
  return { store, setEnabled, setSound, preview }
}

describe('NotificationsRow', () => {
  it('renders title and switch; pickers stay hidden while disabled', () => {
    mount(false)
    expect(screen.getByText('Notification sounds')).toBeDefined()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Work finished')).toBeNull()
  })

  it('enabled shows one picker row per event with its assigned sound selected', () => {
    mount(true)
    expect(screen.getByText('Work finished')).toBeDefined()
    expect(screen.getByText('Needs your attention')).toBeDefined()
    expect(screen.getByText('Error occurred')).toBeDefined()
    // doneSound was synced as bell.
    expect(screen.getAllByRole('button', { name: /^Bell$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('switch click drives setEnabled', () => {
    const b = mount(false)
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setEnabled).toHaveBeenCalledWith(true)
  })

  it('chip and preview clicks drive the injected face', () => {
    const b = mount(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pulse' })[0]!)
    expect(b.setSound).toHaveBeenLastCalledWith('done', 'pulse')
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[1]!)
    expect(b.preview).toHaveBeenCalledWith('attention')
  })

  it('store sync moves selection without further clicks', () => {
    const b = mount(true)
    expect(screen.getAllByRole('button', { name: /^Bell$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      b.store.actions.sync({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, doneSound: 'chime', revision: 1 })
    })
    expect(screen.getAllByRole('button', { name: /^Chime$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
  })
})
