/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { MODELS_SETTINGS_NAMESPACE, PROVIDER_ORDER_FIELD } from './provider-order.ts'

export { MODELS_SETTINGS_NAMESPACE, PROVIDER_ORDER_FIELD } from './provider-order.ts'

const MODELS_NAMESPACE = settingsNamespace(MODELS_SETTINGS_NAMESPACE)

/** Durable provider-order section. */
export interface ModelsSettings {
  /** Provider route ids in display order, first = top. */
  providerOrder?: string[]
}

/** Durable provider-order schema (object properties are optional by default). */
export const ModelsSettingsSchema: z<ModelsSettings> = z.object({
  [PROVIDER_ORDER_FIELD]: z.array(z.string()),
})

/**
 * Register the durable provider-order section when the optional settings
 * service is composed; the Models page and the host api-proxy both read it by
 * namespace name.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(MODELS_NAMESPACE, ModelsSettingsSchema)
  })
}
