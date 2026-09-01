/**
 * Package-owned invariant companion.
 * @module @deepseek-ai/dsh-host-remote/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { REMOTE_DEVICES_DOMAIN } from './registry.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-remote'

/** Cordis companion plugin name. */
export const name = 'host-remote-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Runtime invariant: every durable write to the remote-devices domain keeps
 * the record shape this package persists. The storage layer already validates
 * against the domain's zod schema; this listener re-checks the persisted
 * secret field so a schema drift cannot silently persist a plaintext secret —
 * the `secretHash` is the only secret material that may reach the medium.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== REMOTE_DEVICES_DOMAIN.name) return
    if (change.table !== 'devices' || change.operation !== 'put') return
    const value = change.value as { secretHash?: unknown }
    if (typeof value.secretHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.secretHash)) {
      return fail(
        `device record ${change.key} persisted a non-hash secret field`
        + ' (plaintext secrets must never reach the medium)',
      )
    }
  }, { global: true })
}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
