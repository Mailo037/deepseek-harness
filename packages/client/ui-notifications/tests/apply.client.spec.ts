/** ui-notifications apply wiring: service provision, settings dictionaries,
 * declaration-aware row registration, snapshot projection into the row store,
 * and write routing through the injected face. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  createSnapshotStore, SlotRegistry, type SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, SETTINGS_NS } from '@deepseek-ai/dsh-client-ui-notifications/client'
import { NotificationRuntime } from '../src/client/runtime.ts'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_NAMESPACE, NotificationSettingsSchema,
} from '../src/notification-settings.ts'
import { NotificationsRow } from '../src/client/NotificationsRow.tsx'
import type { createNotificationsRowStore } from '../src/client/settings-store.ts'

const SLOT = 'settings.general.item'

function emptyList(): SessionListState {
  return {
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

async function bench(section: Record<string, unknown> = { ...DEFAULT_NOTIFICATION_SETTINGS }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const list = createSnapshotStore<SessionListState>(emptyList())
  ctx.provide('sessions', { list } as never)
  const namespace = () => ({
    ns: NOTIFICATION_SETTINGS_NAMESPACE,
    schema: NotificationSettingsSchema.toJSON(),
    value: section,
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'notifications-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn(() => Promise.resolve({
    rpcId: 'notifications-mutate' as never,
    result: { ok: true as const, value: namespace() },
  }))
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback: true } as never)
  new TestRemote(ctx)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, describe, mutate }
}

function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === NotificationsRow)!
  const handle = entry.store as ReturnType<typeof createNotificationsRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => {
    setEnabled: (enabled: boolean) => void
    setSound: (kind: 'done' | 'attention' | 'error', sound: string) => void
    preview: (kind: 'done' | 'attention' | 'error') => void
  })(instance.actions)
  return { entry, instance, face }
}

describe('ui-notifications apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service, registers localized copy, and registers the row', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.locale.bind(SETTINGS_NS)('notifications.title')).toBe('通知音效')
    b.locale.setLocale('en')
    expect(b.locale.bind(SETTINGS_NS)('notifications.title')).toBe('Notification sounds')
    const entry = b.slots.entries(SLOT).find(e => e.component === NotificationsRow)!
    expect(entry.options).toMatchObject({ id: 'notifications', order: 11 })
    expect(b.ctx.get('notifications')).toBeInstanceOf(NotificationRuntime)
  })

  it('activates before or after the slot declaration', async () => {
    const before = await bench()
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries(SLOT)).toHaveLength(0)
    declareItems(before.slots)
    await Promise.resolve()
    expect(before.slots.entries(SLOT).some(e => e.component === NotificationsRow)).toBe(true)

    const after = await bench()
    declareItems(after.slots)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(SLOT)).toHaveLength(1)
  })

  it('projects the service snapshot into the row store and routes face writes back', async () => {
    const b = await bench({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: true })
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot()).toMatchObject({ enabled: true, doneSound: 'chime', revision: expect.any(Number) })
    expect(b.slots.entries(SLOT).find(e => e.component === NotificationsRow)!.locale).toBe(SETTINGS_NS)

    face.setSound('error', 'bell')
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalled() })

    // The watcher rides the same service: a transition on an enabled scope plays.
    const notifications = b.ctx.get('notifications') as NotificationRuntime
    expect(notifications.getSnapshot().enabled).toBe(true)
  })

  it('teardown removes the row and the dictionaries', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind(SETTINGS_NS)('notifications.title')).toBe('notifications.title')
  })
})
