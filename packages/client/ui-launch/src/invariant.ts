/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-launch`.
 * @module @deepseek-ai/dsh-client-ui-launch/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-launch'

/** Cordis companion plugin name. */
export const name = 'client-ui-launch-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin emits no cordis events and owns no
 * cross-plugin mutable state — its only durable surface is the Host-registered
 * `ui-launch` settings namespace validated by the shared schema, and its only
 * effect is the launch backend's own `apply` contract, asserted directly by
 * this package's host and row specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
