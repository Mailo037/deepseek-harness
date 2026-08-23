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
import { NotificationRuntime } from '../src/client/runtime.ts'

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
    byId: Object.fromEntries(rows.map(r => [r.id, r])) as SessionListState['byId'],
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

async function runtime(section: NotificationSettings | undefined = DEFAULT_NOTIFICATION_SETTINGS) {
  const ctx = new Context()
  const list = createSnapshotStore<SessionListState>(emptyList())
  const play = vi.fn()
  const host = fakeHost(section)
  const service = new NotificationRuntime(ctx, host.host, { list }, play)
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
    expect(() => b.service.setSound('done', 'scream' as never)).toThrow()

    b.service.preview('error')
    expect(b.play).toHaveBeenCalledWith('pulse')

    // A same-value write is a no-op.
    b.set.mockClear()
    b.service.setSound('attention', 'ping')
    expect(b.set).not.toHaveBeenCalled()
  })

  it('adopts Host-side section changes without writing back', async () => {
    const b = await runtime()
    await b.publish({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, doneSound: 'bell' })
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
    await b.publish({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true, doneSound: 'bell' })
    b.list.set(withRows(row('a', { running: true })))
    b.list.set(withRows(row('a')))
    expect(b.play).toHaveBeenLastCalledWith('bell')
  })
})
