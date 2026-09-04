/** NotificationRuntime: Host adoption, transition playback through the
 * sessions list store, write routing, and preview semantics. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  createSnapshotStore, type SessionId, type SessionListState, type SessionSummary,
  type SettingsScope, type SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings,
} from '../src/notification-settings.ts'
import {
  defaultNotificationPresenter, NotificationRuntime, openSessionSafely,
  type NotificationPresenter,
} from '../src/client/runtime.ts'

function emptyList(): SessionListState {
  return {
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function row(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

function withRows(...rows: SessionSummary[]): SessionListState {
  return {
    ...emptyList(),
    ids: rows.map(r => r.id),
    byId: Object.fromEntries(rows.map(r => [r.id, r])),
  }
}

function fakeHost(section: NotificationSettings | undefined) {
  const snapshot: SettingsScopeSnapshot<NotificationSettings> = {
    status: section === undefined ? 'loading' : 'ready',
    value: section,
    base: undefined,
    user: undefined,
    revision: section === undefined ? undefined : 0,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const set = vi.fn(() => Promise.resolve())
  const host: SettingsScope<NotificationSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set,
    unset: () => Promise.resolve(),
  }
  const publish = (next: NotificationSettings): void => {
    snapshot.value = next
    for (const listener of listeners) listener()
  }
  return { host, set, publish }
}

async function runtime(
  section: NotificationSettings | undefined = DEFAULT_NOTIFICATION_SETTINGS,
  notify?: NotificationPresenter,
) {
  const ctx = new Context()
  const list = createSnapshotStore<SessionListState>(emptyList())
  const play = vi.fn()
  const host = fakeHost(section)
  const service = new NotificationRuntime(ctx, host.host, { list }, play, notify)
  return { ctx, list, play, ...host, service }
}

describe('NotificationRuntime', () => {
  it('seeds the baseline without playing and stays silent while disabled', async () => {
    const b = await runtime({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true })
    // The seeded baseline carries a running session; observing the same state again is silence.
    b.list.set(withRows(row('a', { running: true })))
    expect(b.play).not.toHaveBeenCalled()

    // Disabled by default: even a real transition plays nothing.
    const quiet = await runtime(DEFAULT_NOTIFICATION_SETTINGS)
    quiet.list.set(withRows(row('a', { running: true })))
    quiet.list.set(withRows(row('a')))
    expect(quiet.play).not.toHaveBeenCalled()
  })

  it('plays one sound per flush with error > attention > done priority', async () => {
    const b = await runtime({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true })
    b.list.set(withRows(row('a', { running: true })))
    // done alone.
    b.list.set(withRows(row('a')))
    expect(b.play).toHaveBeenLastCalledWith('chime')

    // error beats done in the same flush.
    b.list.set(withRows(row('a', { running: true })))
    b.list.set(withRows(row('a', { attention: 'error', completed: true })))
    expect(b.play).toHaveBeenCalledTimes(2)
    expect(b.play).toHaveBeenLastCalledWith('pulse')
  })

  it('routes writes through the settings scope and previews regardless of opt-in', async () => {
    const b = await runtime()
    b.service.setEnabled(true)
    expect(b.set).toHaveBeenCalledWith('enabled', true)
    b.service.setSound('attention', 'ping')
    expect(b.set).toHaveBeenCalledWith('attentionSound', 'ping')
    expect(b.service.getSnapshot()).toMatchObject({ enabled: true, attentionSound: 'ping' })
    expect(() => { b.service.setSound('done', 'scream' as never) }).toThrow()

    b.service.preview('error')
    expect(b.play).toHaveBeenCalledWith('pulse')

    // A same-value write is a no-op.
    b.set.mockClear()
    b.service.setSound('attention', 'ping')
    expect(b.set).not.toHaveBeenCalled()
  })

  it('adopts Host-side section changes without writing back', async () => {
    const b = await runtime()
    b.publish({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, doneSound: 'bell' })
    expect(b.service.getSnapshot().enabled).toBe(true)
    expect(b.service.getSnapshot().doneSound).toBe('bell')
    b.set.mockClear()
    b.service.setEnabled(false)
    expect(b.set).toHaveBeenCalledWith('enabled', false)

    // A section-less scope keeps defaults and never throws on adoption.
    const bare = await runtime(undefined)
    expect(bare.service.getSnapshot().enabled).toBe(false)
  })

  it('adopts a Host-side sound change before the next flush plays it', async () => {
    const b = await runtime({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true })
    b.publish({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, doneSound: 'bell' })
    b.list.set(withRows(row('a', { running: true })))
    b.list.set(withRows(row('a')))
    expect(b.play).toHaveBeenLastCalledWith('bell')
  })

  it('notifies each event through the presenter when enabled', async () => {
    const notify = vi.fn()
    const b = await runtime({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true }, notify)
    b.list.set(withRows(row('s1', { running: true }), row('s2', { running: true })))
    b.list.set(withRows(row('s1'), row('s2', { attention: 'error' })))
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledWith(
      { sessionId: 's1', kind: 'done' },
      expect.objectContaining({ id: 's1' }),
    )
    expect(notify).toHaveBeenCalledWith(
      { sessionId: 's2', kind: 'error' },
      expect.objectContaining({ id: 's2' }),
    )

    // Silent when disabled.
    notify.mockClear()
    b.service.setEnabled(false)
    b.list.set(withRows(row('s1', { running: true })))
    b.list.set(withRows(row('s1')))
    expect(notify).not.toHaveBeenCalled()
  })

  it('openSessionSafely opens immediately or defers until listed', () => {
    const list = createSnapshotStore<SessionListState>(emptyList())
    const open = vi.fn()
    const sessions = { list, open }

    // Case 1: already present.
    list.set(withRows(row('s1')))
    openSessionSafely(sessions, 's1' as SessionId)
    expect(open).toHaveBeenCalledWith('s1')

    // Case 2: deferred until arrival.
    open.mockClear()
    list.set({ ...emptyList(), phase: 'pending' })
    openSessionSafely(sessions, 's2' as SessionId)
    expect(open).not.toHaveBeenCalled()

    list.set(withRows(row('s2')))
    expect(open).toHaveBeenCalledWith('s2')

    // Case 3: list settles ready without the session.
    open.mockClear()
    list.set({ ...emptyList(), phase: 'pending' })
    openSessionSafely(sessions, 's3' as SessionId)
    expect(open).not.toHaveBeenCalled()
    list.set({ ...emptyList(), phase: 'ready' })
    expect(open).not.toHaveBeenCalled()
  })

  it('defaultNotificationPresenter creates Notification and handles click navigation', () => {
    const list = createSnapshotStore<SessionListState>(withRows(row('s1', { displayTitle: 'My Task' })))
    const open = vi.fn()
    const sessions = { list, open }
    const translator = { t: (k: string) => `trans:${k}` }

    const originalNotification = globalThis.Notification
    const originalWindow = globalThis.window
    const focus = vi.fn()
    globalThis.window = { focus } as unknown as Window & typeof globalThis

    try {
      interface FakeNotificationInstance {
        title: string
        options: unknown
        onclick?: (() => void) | undefined
        close: () => void
      }
      const instances: FakeNotificationInstance[] = []
      const fakeNotification = vi.fn(function (this: unknown, title: string, options: unknown) {
        const inst: FakeNotificationInstance = { title, options, close: vi.fn() }
        instances.push(inst)
        return inst
      }) as unknown as typeof Notification
      Object.defineProperty(fakeNotification, 'permission', { value: 'granted', configurable: true })
      globalThis.Notification = fakeNotification

      const presenter = defaultNotificationPresenter(sessions, translator)
      presenter({ sessionId: 's1' as SessionId, kind: 'done' }, list.getSnapshot().byId['s1' as SessionId])

      expect(instances).toHaveLength(1)
      const first = instances[0]
      expect(first).toBeDefined()
      if (!first) throw new Error('expected notification instance')
      expect(first.title).toBe('My Task')
      expect(first.options).toEqual({
        body: 'trans:notifications.event.done',
        tag: 'dsh-s1',
      })

      // Clicking triggers focus and session open.
      first.onclick?.()
      expect(focus).toHaveBeenCalled()
      expect(open).toHaveBeenCalledWith('s1')
      expect(first.close).toHaveBeenCalled()

      // When permission is not granted, does nothing.
      instances.length = 0
      Object.defineProperty(fakeNotification, 'permission', { value: 'denied', configurable: true })
      presenter({ sessionId: 's1' as SessionId, kind: 'error' }, list.getSnapshot().byId['s1' as SessionId])
      expect(instances).toHaveLength(0)
    } finally {
      globalThis.Notification = originalNotification
      globalThis.window = originalWindow
    }
  })
})
