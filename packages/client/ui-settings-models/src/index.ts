/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  HIDDEN_PROVIDERS_FIELD, MODELS_SETTINGS_NAMESPACE, PROVIDER_ORDER_FIELD,
} from './provider-order.ts'

export {
  HIDDEN_PROVIDERS_FIELD, MODELS_SETTINGS_NAMESPACE, PROVIDER_ORDER_FIELD,
} from './provider-order.ts'

const MODELS_NAMESPACE = settingsNamespace(MODELS_SETTINGS_NAMESPACE)

/** Durable provider-order section. */
export interface ModelsSettings {
  /** Provider route ids in display order, first = top. */
  providerOrder?: string[]
  /** Provider route ids omitted from the advisory model-picker catalog. */
  hiddenProviders?: string[]
}

/** Durable model-picker-preference schema (object properties are optional by default). */
export const ModelsSettingsSchema: z<ModelsSettings> = z.object({
  [PROVIDER_ORDER_FIELD]: z.array(z.string()),
  [HIDDEN_PROVIDERS_FIELD]: z.array(z.string()),
})

/**
 * Register the durable model-picker-preference section when the optional
 * settings service is composed; the Models page and the host api-proxy both
 * read it by namespace name.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(MODELS_NAMESPACE, ModelsSettingsSchema)
  })
}
