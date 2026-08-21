/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-self-update`.
 * @module @deepseek-ai/dsh-host-self-update/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-self-update'

/** Cordis companion plugin name. */
export const name = 'host-self-update-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the owned relation — agents quiesced before a pull —
 * is enforced inside the wire consumer's single apply flow and covered by its
 * unit tests; git subprocesses own no event stream the teardown channel could
 * observe, so a probe here could only restate the unit assertions.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
