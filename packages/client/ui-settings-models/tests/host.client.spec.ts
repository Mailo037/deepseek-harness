/** Node-half host registration: the durable provider-order settings section. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { MODELS_SETTINGS_NAMESPACE, apply, ModelsSettingsSchema } from '../src/index.ts'
import { PROVIDER_ORDER_FIELD } from '../src/provider-order.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-models host', () => {
  it('registers, validates, and disposes the provider-order namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    expect(ctx.settings).toBeDefined()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(MODELS_SETTINGS_NAMESPACE)
    // The inject callback registers the namespace once the settings service is
    // available, so the registration lands on a later tick than the fiber.
    await vi.waitFor(() => { expect(ctx.settings.get(ns)).toEqual({ [PROVIDER_ORDER_FIELD]: [] }) })
    await ctx.settings.update(ns, { [PROVIDER_ORDER_FIELD]: ['openai', 'deepseek-official'] })
    expect(ctx.settings.get(ns)).toEqual({ [PROVIDER_ORDER_FIELD]: ['openai', 'deepseek-official'] })
    // The schema rejects a non-array field value.
    await expect(ctx.settings.update(ns, { [PROVIDER_ORDER_FIELD]: 'openai' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('exports the schema and field contract the browser and host share', () => {
    expect(PROVIDER_ORDER_FIELD).toBe('providerOrder')
    expect(ModelsSettingsSchema({ [PROVIDER_ORDER_FIELD]: ['a'] })).toEqual({ [PROVIDER_ORDER_FIELD]: ['a'] })
    // A missing field resolves to the schema's materialized empty array.
    expect(ModelsSettingsSchema({})).toEqual({ [PROVIDER_ORDER_FIELD]: [] })
  })
})
