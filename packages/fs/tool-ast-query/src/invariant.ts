/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-ast-query`.
 * @module @deepseek-ai/dsh-tool-ast-query/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-ast-query'

/** Cordis companion plugin name. */
export const name = 'tool-ast-query-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless adapter records no independent lifecycle
 * relation; source observations and tool execution remain owned by `ctx.fs` and
 * the tool runtime.
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
