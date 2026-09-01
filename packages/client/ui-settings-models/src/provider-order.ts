/**
 * Provider-picker preferences shared by the Models settings page and the
 * model selector surfaces. The namespace name is a wire contract — the host
 * api-proxy reads it by name, exactly as client settings writes address
 * namespaces by name.
 */

/** Settings namespace owned by the Models settings plugin. */
export const MODELS_SETTINGS_NAMESPACE = 'models'

/** Field carrying the provider route ids in display order, first = top. */
export const PROVIDER_ORDER_FIELD = 'providerOrder'

/** Field carrying provider route ids excluded only from model selectors. */
export const HIDDEN_PROVIDERS_FIELD = 'hiddenProviders'
