/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-shell-command`:
 * shell-command lifecycle events pair by commandId within one session log.
 * @module @deepseek-ai/dsh-shell-command/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-shell-command'

/** Cordis companion plugin name. */
export const name = 'shell-command-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install pairing validation over loaded logs and newly appended lifecycle events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // Install-scoped so a dispose/re-register cycle re-sweeps from a clean slate.
  const runIds = new WeakMap<Session, Set<string>>()
  const validateEvent = (session: Session, event: SessionEvent): void => {
    if (event.type === 'shell/run') {
      const ids = runIds.get(session) ?? new Set<string>()
      if (ids.has(event.data.commandId)) {
        fail(`shell/run repeats commandId ${JSON.stringify(event.data.commandId)}`)
      }
      ids.add(event.data.commandId)
      runIds.set(session, ids)
      return
    }
    if (event.type !== 'shell/done') return
    if (runIds.get(session)?.has(event.data.commandId) !== true) {
      fail(`shell/done ${JSON.stringify(event.data.commandId)} pairs no prior shell/run in this log`)
    }
  }
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, event)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
