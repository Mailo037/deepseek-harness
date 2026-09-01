/**
 * Node-half loader entry of @deepseek-ai/dsh-client-ui-remote. The browser
 * half (src/client) is a dynamic row served by the modules registry; this
 * entry exists so the Loader can mount the row with no host-plane behavior.
 */

/** Stable Cordis plugin name. */
export const name = 'client-ui-remote'

/** No host-plane behavior: the browser half registers the settings section. */
export function apply(): void {}
