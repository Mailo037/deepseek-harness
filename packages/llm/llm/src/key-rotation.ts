/**
 * Per-provider API-key rotation state, shared between a provider plugin's
 * per-request credential resolver and its `agent/request-error` recovery
 * listener. One instance per provider plugin; the provider routes are the
 * keys, and each holds the credential refs currently retired to a cooldown.
 *
 * The resolver picks the first non-exhausted ref, so the very next request
 * after a quota failure skips the exhausted key without paying the failed
 * attempt again. The recovery listener marks the failed ref exhausted and
 * asks for a retry only while another ref remains usable, which bounds one
 * step's rotation by the configured key count.
 *
 * @module @deepseek-ai/dsh-llm/key-rotation
 */

import { QUOTA_EXCEEDED_CODE } from './error.ts'
import type { LlmFailure } from './types.ts'

/** Default cooldown after one key hits a quota-classified failure (one hour). */
export const DEFAULT_KEY_COOLDOWN_MS = 3_600_000

/**
 * Per-provider cooldown registry for exhausted API-key refs. State is
 * in-memory and process-local by design: a restart re-probes the primary key
 * once, which is the same cost a recovered quota already imposes.
 */
export class KeyRotation {
  private readonly exhausted = new Map<string, Map<string, number>>()

  /**
   * @param now - wall-clock source in milliseconds; injectable for determinism in tests.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Retire one credential ref for one provider until `now() + cooldownMs`.
   * Marking a ref the provider does not configure is a no-op.
   * @param provider - provider route id.
   * @param ref - the credential reference that just failed.
   * @param cooldownMs - how long the ref stays retired.
   * @param refs - the provider's configured refs; a ref outside them is not marked.
   */
  markExhausted(provider: string, ref: string, cooldownMs: number, refs: readonly string[]): void {
    if (!refs.includes(ref)) return
    let byRef = this.exhausted.get(provider)
    if (byRef === undefined) {
      byRef = new Map()
      this.exhausted.set(provider, byRef)
    }
    byRef.set(ref, this.now() + cooldownMs)
  }

  /**
   * The configured refs of one provider that are not currently exhausted, in
   * configuration order. Expired entries are dropped on read, so a recovered
   * key reappears at its configured position without any timer.
   * @param provider - provider route id.
   * @param refs - the provider's configured refs in rotation order.
   * @returns the usable subset, order preserved.
   */
  usableRefs(provider: string, refs: readonly string[]): string[] {
    const now = this.now()
    const byRef = this.exhausted.get(provider)
    if (byRef === undefined) return [...refs]
    const usable: string[] = []
    for (const ref of refs) {
      const until = byRef.get(ref)
      if (until === undefined) {
        usable.push(ref)
        continue
      }
      if (until <= now) {
        byRef.delete(ref)
        usable.push(ref)
      }
    }
    if (byRef.size === 0) this.exhausted.delete(provider)
    return usable
  }

  /**
   * Whether at least one configured ref of one provider is not currently
   * exhausted — the gate a recovery listener uses before asking for a retry.
   * @param provider - provider route id.
   * @param refs - the provider's configured refs in rotation order.
   * @returns true while a retry can reach a different, non-exhausted ref.
   */
  hasUsable(provider: string, refs: readonly string[]): boolean {
    return this.usableRefs(provider, refs).length > 0
  }
}

/**
 * Pick the first non-exhausted ref for a new request. When every configured
 * ref is exhausted the first one is still returned, so the provider's real
 * failure surfaces instead of a `MISSING_CREDENTIAL` for a ref that exists —
 * the cooldown only ever redirects traffic, never hides the underlying limit.
 * @param rotation - the provider plugin's rotation state.
 * @param provider - provider route id.
 * @param refs - the provider's configured refs in rotation order; non-empty by config contract.
 * @returns the ref to resolve; always one of {@link refs}.
 */
export function pickRotationRef<R extends string>(
  rotation: KeyRotation,
  provider: string,
  refs: readonly R[],
): R {
  const usable = rotation.usableRefs(provider, refs)
  // usableRefs preserves configuration order, so the fallback below is the
  // first configured ref — the same ref a single-key provider always resolves.
  // Both consumers guarantee a non-empty list; the assertion is the typed form
  // of that config contract, which noUncheckedIndexedAccess cannot see.
  return (usable.length > 0 ? usable[0] : refs[0]) as R
}

/**
 * The one decision behind rotating keys after a quota-classified failure:
 * retire the failed ref for the provider's cooldown, then retry while another
 * configured ref remains usable. Any other failure code, a failure without a
 * key reference, or a provider with nothing to rotate stays terminal — the
 * `terminal` answer for an unretryable failure is what lets the caller
 * delegate instead of looping on the same key.
 * @param rotation - the provider plugin's rotation state.
 * @param provider - provider route id.
 * @param failure - the failure facts carried by `agent/request-error`.
 * @param refs - the provider's configured refs in rotation order.
 * @param cooldownMs - how long a quota-failed ref stays retired.
 * @returns `retry` when the next attempt can reach a different key; `terminal` otherwise.
 */
export function rotateAfterQuotaFailure(
  rotation: KeyRotation,
  provider: string,
  failure: LlmFailure,
  refs: readonly string[],
  cooldownMs: number,
): 'retry' | 'terminal' {
  if (failure.code !== QUOTA_EXCEEDED_CODE || failure.apiKeyRef === undefined) return 'terminal'
  if (refs.length < 2 || !refs.includes(failure.apiKeyRef)) return 'terminal'
  rotation.markExhausted(provider, failure.apiKeyRef, cooldownMs, refs)
  return rotation.hasUsable(provider, refs) ? 'retry' : 'terminal'
}
