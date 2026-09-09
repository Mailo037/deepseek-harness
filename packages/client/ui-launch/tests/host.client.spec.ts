/** ui-launch host half: registers, validates, and disposes the durable launch
 * namespace, and routes committed values into the surface-provided backend.
 * Without a backend the namespace is not registered at all. */
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply, type LaunchItemBackend } from '../src/index.ts'
import { DEFAULT_LAUNCH_SETTINGS, LAUNCH_SETTINGS_NAMESPACE } from '../src/launch-settings.ts'

/** The provider's on-disk document, reseeded per test before boot. */
let seedDocument: Record<string, unknown> = {}

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(seedDocument) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    seedDocument[ns] = section
    return Promise.resolve()
  }
}

function backend(supported = true): LaunchItemBackend & { calls: boolean[] } {
  const calls: boolean[] = []
  return { supported, apply: (launchAtLogin: boolean) => { calls.push(launchAtLogin) }, calls }
}

beforeEach(() => { seedDocument = {} })

describe('ui-launch host', () => {
  it('applies the stored preference on boot and every committed change', async () => {
    seedDocument = { 'ui-launch': { launchAtLogin: true } }
    const ctx = new Context()
    const item = backend()
    ctx.provide('launchSettings', item)
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    // Boot applied the user's stored override exactly once.
    expect(item.calls).toEqual([true])

    const ns = settingsNamespace(LAUNCH_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ launchAtLogin: true })
    await ctx.settings.update(ns, { launchAtLogin: false })
    await vi.waitFor(() => { expect(item.calls).toEqual([true, false]) })
    await expect(ctx.settings.update(ns, { launchAtLogin: 'yes' })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('never applies an untouched default and keeps defaults opt-in', async () => {
    const ctx = new Context()
    const item = backend()
    ctx.provide('launchSettings', item)
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()

    const ns = settingsNamespace(LAUNCH_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ ...DEFAULT_LAUNCH_SETTINGS })
    expect(item.calls).toEqual([])

    // A committed change applies, default or not.
    await ctx.settings.update(ns, { launchAtLogin: true })
    await vi.waitFor(() => { expect(item.calls).toEqual([true]) })
  })

  it('registers nothing without a launch backend', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(LAUNCH_SETTINGS_NAMESPACE)
  })

  it('registers nothing with an unsupported backend', async () => {
    const ctx = new Context()
    ctx.provide('launchSettings', backend(false))
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(LAUNCH_SETTINGS_NAMESPACE)
  })
})
