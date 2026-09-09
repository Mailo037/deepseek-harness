/** ui-launch apply wiring: service provision, settings dictionaries,
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
import { apply, inject, SETTINGS_NS } from '@deepseek-ai/dsh-client-ui-launch/client'
import { LaunchSettingsController } from '../src/client/controller.ts'
import { DEFAULT_LAUNCH_SETTINGS, LAUNCH_SETTINGS_NAMESPACE, LaunchSettingsSchema } from '../src/launch-settings.ts'
import { LaunchRow } from '../src/client/LaunchRow.tsx'
import type { createLaunchRowStore } from '../src/client/store.ts'

const SLOT = 'settings.general.item'

function emptyList(): SessionListState {
  return {
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

async function bench(section: Record<string, unknown> = { ...DEFAULT_LAUNCH_SETTINGS }) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const list = createSnapshotStore<SessionListState>(emptyList())
  ctx.provide('sessions', { list } as never)
  const namespace = () => ({
    ns: LAUNCH_SETTINGS_NAMESPACE,
    schema: LaunchSettingsSchema.toJSON(),
    value: section,
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'launch-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn((_payload: unknown) => Promise.resolve({
    rpcId: 'launch-mutate' as never,
    result: { ok: true as const, value: namespace() },
  }))
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback: true } as never)
  new TestRemote(ctx)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate }
}

function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === LaunchRow)!
  const handle = entry.store as ReturnType<typeof createLaunchRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => {
    setLaunchAtLogin: (launchAtLogin: boolean) => void
  })(instance.actions)
  return { entry, instance, face }
}

describe('ui-launch apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the controller, registers localized copy, and registers the row', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.locale.bind(SETTINGS_NS)('launch.title')).toBe('开机自启')
    b.locale.setLocale('en')
    expect(b.locale.bind(SETTINGS_NS)('launch.title')).toBe('Start at computer startup')
    const entry = b.slots.entries(SLOT).find(e => e.component === LaunchRow)!
    expect(entry.options).toMatchObject({ id: 'launch', order: 12 })
    expect(b.ctx.get('launch')).toBeInstanceOf(LaunchSettingsController)
  })

  it('activates before or after the slot declaration', async () => {
    const before = await bench()
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries(SLOT)).toHaveLength(0)
    declareItems(before.slots)
    await Promise.resolve()
    expect(before.slots.entries(SLOT).some(e => e.component === LaunchRow)).toBe(true)

    const after = await bench()
    declareItems(after.slots)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries(SLOT)).toHaveLength(1)
  })

  it('projects the controller snapshot into the row store and routes the switch write', async () => {
    const b = await bench({ ...DEFAULT_LAUNCH_SETTINGS, launchAtLogin: true })
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot()).toMatchObject({ available: true, launchAtLogin: true })
    expect(b.slots.entries(SLOT).find(e => e.component === LaunchRow)!.locale).toBe(SETTINGS_NS)

    face.setLaunchAtLogin(false)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalled() })
    expect(b.mutate.mock.calls[0]![0]).toMatchObject({ ns: LAUNCH_SETTINGS_NAMESPACE })
  })

  it('teardown removes the row and the dictionaries', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind(SETTINGS_NS)('launch.title')).toBe('launch.title')
  })
})
