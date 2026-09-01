// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { RemoteSettingsSection } from '../src/client/RemoteSettingsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('settingsScope', {
    bind: () => ({
      getSnapshot: () => ({ status: 'ready', value: { patterns: [] }, base: undefined, user: undefined, revision: 0, writable: true, mode: 'host' }),
      set: vi.fn(),
      unset: vi.fn(),
      subscribe: () => () => {},
    }),
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  // The gateway installs each mounted namespace as its own service keyed
  // `remote.<namespace>`; the apply reads it through ctx.remote.device.
  const device = {
    pairingCreate: vi.fn(),
    devicesList: vi.fn(),
    devicesRevoke: vi.fn(),
    accessTokenGet: vi.fn(),
  }
  ctx.provide('remote.device', device)
  // The sessions read face the Tailscale handoff resolves its target from.
  // Loose on purpose: each test re-points the stub at its own scenario.
  const emptyList = {
    ids: [] as string[], byId: {} as Record<string, unknown>, current: undefined as string | undefined,
    phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined as unknown,
  }
  const sessions: {
    list: { getSnapshot: () => Record<string, unknown> }
    binding: (id?: unknown) => unknown
  } = {
    list: { getSnapshot: vi.fn(() => ({ ...emptyList })) },
    binding: vi.fn(() => undefined),
  }
  ctx.provide('sessions', sessions)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, device, sessions }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-remote browser plugin', () => {
  it('declares only the services it actually uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope', 'remote', 'remote.device', 'sessions'])
  })

  it('registers a localized section without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(RemoteSettingsSection)
    expect(entry.options).toMatchObject({ id: 'remote', order: 15 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('远程设备')
    // The Remote must not be called until the user interacts.
    expect(b.device.pairingCreate).not.toHaveBeenCalled()
    expect(b.device.devicesList).not.toHaveBeenCalled()

    // The injected callbacks reach the remote namespace on demand.
    const injected = (entry.inject as unknown as () => {
      createPairing: () => Promise<unknown>
      listDevices: () => Promise<unknown>
    })()
    b.device.devicesList = vi.fn().mockResolvedValue({ ok: true, value: { devices: [] } })
    await expect(injected.listDevices()).resolves.toEqual({ devices: [] })
    expect(b.device.devicesList).toHaveBeenCalledOnce()

    b.device.devicesList = vi.fn().mockResolvedValue({ ok: false, error: { code: 'REMOTE_ERROR', message: 'nope' } })
    await expect(injected.listDevices()).rejects.toThrow('device.devicesList failed: REMOTE_ERROR: nope')

    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // No declaration → no entry.
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(2) })
    b.locale.setLocale('en')
    const remote = b.slots.entries('settings.section').find(e => String(e.options.id) === 'remote')
    const fsDeny = b.slots.entries('settings.section').find(e => String(e.options.id) === 'fs-deny')
    expect(resolveSlotLabel(remote!.options.label)).toBe('Remote devices')
    expect(resolveSlotLabel(fsDeny!.options.label)).toBe('Access restrictions')

    stop()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(0) })
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(2) })
    await b.ctx.fiber.dispose()
  })
})

describe('ui-remote Tailscale handoff', () => {
  function injectedOf(b: Awaited<ReturnType<typeof bench>>) {
    const entry = b.slots.entries('settings.section').find(e => String(e.options.id) === 'remote')!
    return (entry.inject as unknown as () => {
      sendTailscaleSetup: () => Promise<{ ok: boolean; reason?: string }>
    })()
  }

  it('queues the localized setup task into the current ordinary session', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const prompt = vi.fn((_parts?: Array<{ type: string; text: string }>, _mode?: string) =>
      Promise.resolve({ ok: true, value: { accepted: true } }))
    b.sessions.list.getSnapshot = vi.fn(() => ({
      ids: ['s1'], byId: { s1: {} }, current: 's1', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }))
    b.sessions.binding = vi.fn(() => ({ session: { prompt } }))

    await expect(injectedOf(b).sendTailscaleSetup()).resolves.toEqual({ ok: true })
    expect(prompt).toHaveBeenCalledOnce()
    const [parts, mode] = prompt.mock.calls[0] ?? []
    expect(mode).toBe('queue')
    expect(parts).toHaveLength(1)
    expect(parts?.[0]?.text).toContain('dsh-tailscale-remote-setup')
    await b.ctx.fiber.dispose()
  })

  it('refuses without a current ordinary session', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const send = () => injectedOf(b).sendTailscaleSetup()

    // No current selection at all.
    await expect(send()).resolves.toEqual({ ok: false, reason: 'no-session' })

    // The current route is a subagent catalog, not an ordinary session.
    b.sessions.list.getSnapshot = vi.fn(() => ({
      ids: ['s1'], byId: { s1: {} }, current: 's1', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: { parent: 's1' },
    }))
    await expect(send()).resolves.toEqual({ ok: false, reason: 'no-session' })

    // The current session vanished between snapshot and binding.
    b.sessions.list.getSnapshot = vi.fn(() => ({
      ids: ['s1'], byId: { s1: {} }, current: 's1', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }))
    await expect(send()).resolves.toEqual({ ok: false, reason: 'no-session' })

    expect(b.sessions.binding).toHaveBeenCalledTimes(1)
    await b.ctx.fiber.dispose()
  })

  it('maps a rejected prompt to the send-error outcome', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    b.sessions.list.getSnapshot = vi.fn(() => ({
      ids: ['s1'], byId: { s1: {} }, current: 's1', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }))
    b.sessions.binding = vi.fn(() => ({
      session: { prompt: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'X', message: 'nope' } })) },
    }))

    await expect(injectedOf(b).sendTailscaleSetup()).resolves.toEqual({ ok: false, reason: 'error' })
    await b.ctx.fiber.dispose()
  })
})
