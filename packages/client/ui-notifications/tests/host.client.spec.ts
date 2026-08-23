/** ui-notifications host half: registers and disposes the durable
 * notification settings namespace with its fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply } from '../src/index.ts'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_NAMESPACE,
} from '../src/notification-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-notifications host', () => {
  it('registers, validates, and disposes the durable notification namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(NOTIFICATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS })
    await ctx.settings.update(ns, { enabled: true, errorSound: 'bell' })
    expect(ctx.settings.get(ns)).toMatchObject({ enabled: true, errorSound: 'bell' })
    await expect(ctx.settings.update(ns, { enabled: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
