// @vitest-environment jsdom
/** NotificationsRow behavior: master switch gates the status line and the event
 * pickers, the browser permission state drives the status copy and the request
 * affordance, chip selection follows the store mirror, clicks drive the
 * injected face. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  createSnapshotStore, type SessionListState, type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/notification-settings.ts'
import { NotificationsRow } from '../src/client/NotificationsRow.tsx'
import type { NotificationsRowComponentProps } from '../src/client/NotificationsRow.tsx'
import type { NotificationPermissionState } from '../src/client/runtime.ts'
import { createNotificationsRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'notifications.title': 'Notification sounds',
  'notifications.enable': 'Play a sound when work finishes or needs you',
  'notifications.browser.granted': 'Browser notifications: allowed',
  'notifications.browser.default': 'Browser notifications: not asked yet',
  'notifications.browser.request': 'Ask',
  'notifications.browser.denied': 'Browser notifications: blocked',
  'notifications.browser.deniedHint': 'Allow notifications for this site in the browser settings, then reload this page.',
  'notifications.browser.unsupported': 'This browser does not support system notifications',
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

interface MountOptions {
  enabled: boolean
  permission: NotificationPermissionState
}

function mount({ enabled, permission }: MountOptions) {
  const store = createNotificationsRowStore().create()
  act(() => {
    store.actions.sync({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      enabled,
      doneSound: 'bell',
      permission,
      revision: 0,
    })
  })
  const setEnabled = vi.fn()
  const setSound = vi.fn()
  const preview = vi.fn()
  const requestPermission = vi.fn()
  const props: NotificationsRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setEnabled,
    setSound,
    preview,
    requestPermission,
  }
  render(<NotificationsRow {...props} />)
  return { store, setEnabled, setSound, preview, requestPermission }
}

describe('NotificationsRow', () => {
  it('renders title and switch; status and pickers stay hidden while disabled', () => {
    mount({ enabled: false, permission: 'default' })
    expect(screen.getByText('Notification sounds')).toBeDefined()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Browser notifications: not asked yet')).toBeNull()
    expect(screen.queryByText('Work finished')).toBeNull()
  })

  it('enabled shows the live browser permission status', () => {
    mount({ enabled: true, permission: 'granted' })
    expect(screen.getByText('Browser notifications: allowed')).toBeDefined()
  })

  it('blocked state shows the site-settings hint instead of a request affordance', () => {
    mount({ enabled: true, permission: 'denied' })
    expect(screen.getByText('Browser notifications: blocked')).toBeDefined()
    expect(screen.getByText(COPY['notifications.browser.deniedHint']!)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
  })

  it('unsupported state shows the support note with no request affordance', () => {
    mount({ enabled: true, permission: 'unsupported' })
    expect(screen.getByText('This browser does not support system notifications')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
  })

  it('not-yet-asked state offers the permission request gesture', () => {
    const b = mount({ enabled: true, permission: 'default' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(b.requestPermission).toHaveBeenCalledOnce()
  })

  it('enabled shows one picker row per event with its assigned sound selected', () => {
    mount({ enabled: true, permission: 'granted' })
    expect(screen.getByText('Work finished')).toBeDefined()
    expect(screen.getByText('Needs your attention')).toBeDefined()
    expect(screen.getByText('Error occurred')).toBeDefined()
    // doneSound was synced as bell.
    expect(screen.getAllByRole('button', { name: /^Bell$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('switch click drives setEnabled and the permission request', () => {
    const b = mount({ enabled: false, permission: 'default' })
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setEnabled).toHaveBeenCalledWith(true)
    expect(b.requestPermission).toHaveBeenCalledOnce()
  })

  it('chip and preview clicks drive the injected face', () => {
    const b = mount({ enabled: true, permission: 'granted' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Pulse' })[0]!)
    expect(b.setSound).toHaveBeenLastCalledWith('done', 'pulse')
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[1]!)
    expect(b.preview).toHaveBeenCalledWith('attention')
  })

  it('store sync moves selection without further clicks', () => {
    const b = mount({ enabled: true, permission: 'granted' })
    expect(screen.getAllByRole('button', { name: /^Bell$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
    act(() => {
      b.store.actions.sync({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        enabled: true,
        doneSound: 'chime',
        permission: 'granted',
        revision: 1,
      })
    })
    expect(screen.getAllByRole('button', { name: /^Chime$/ })[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('store sync moves the permission status line', () => {
    const b = mount({ enabled: true, permission: 'default' })
    expect(screen.getByText('Browser notifications: not asked yet')).toBeDefined()
    act(() => {
      b.store.actions.sync({
        ...DEFAULT_NOTIFICATION_SETTINGS,
        enabled: true,
        permission: 'denied',
        revision: 1,
      })
    })
    expect(screen.getByText('Browser notifications: blocked')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
  })
})
