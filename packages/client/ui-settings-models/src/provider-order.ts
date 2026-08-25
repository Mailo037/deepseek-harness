/**
 * Provider display-order preference: the user's arrangement of provider
 * routes, shared by the Models settings page (row order) and the model
 * selector surfaces (group order). The namespace name is a wire contract —
 * the host api-proxy reads it by name, exactly as client settings writes
 * address namespaces by name.
 */

/** Settings namespace owned by the Models settings plugin. */
export const MODELS_SETTINGS_NAMESPACE = 'models'

/** Field carrying the provider route ids in display order, first = top. */
export const PROVIDER_ORDER_FIELD = 'providerOrder'
