import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEY_COOLDOWN_MS,
  KeyRotation,
  pickRotationRef,
  rotateAfterQuotaFailure,
} from '../src/key-rotation.ts'

/** A quota failure shaped like the one an adapter reports after a limit error. */
function quotaFailure(apiKeyRef: string): Parameters<typeof rotateAfterQuotaFailure>[2] {
  return { message: 'usage limit reached', code: 'QUOTA', apiKeyRef }
}

describe('KeyRotation', () => {
  it('serves every configured ref in order while none is exhausted', () => {
    const rotation = new KeyRotation()
    expect(rotation.usableRefs('deepseek', ['A', 'B', 'C'])).toEqual(['A', 'B', 'C'])
    expect(rotation.hasUsable('deepseek', ['A', 'B'])).toBe(true)
  })

  it('retires one ref for its provider alone and restores it after the cooldown', () => {
    let now = 1_000
    const rotation = new KeyRotation(() => now)
    rotation.markExhausted('deepseek', 'A', 1_000, ['A', 'B'])
    expect(rotation.usableRefs('deepseek', ['A', 'B'])).toEqual(['B'])
    // Another provider keeps its own refs untouched.
    expect(rotation.usableRefs('pi-ai', ['A'])).toEqual(['A'])
    // Inside the cooldown window the ref stays retired.
    now = 1_999
    expect(rotation.usableRefs('deepseek', ['A', 'B'])).toEqual(['B'])
    // The expiry boundary re-admits the ref at its configured position.
    now = 2_000
    expect(rotation.usableRefs('deepseek', ['A', 'B'])).toEqual(['A', 'B'])
  })

  it('ignores a ref the provider does not configure', () => {
    const rotation = new KeyRotation()
    rotation.markExhausted('deepseek', 'FOREIGN', 1_000, ['A', 'B'])
    expect(rotation.usableRefs('deepseek', ['A', 'B'])).toEqual(['A', 'B'])
  })

  it('drops expired entries and forgets the provider once nothing is retired', () => {
    let now = 0
    const rotation = new KeyRotation(() => now)
    rotation.markExhausted('deepseek', 'A', 100, ['A', 'B'])
    now = 101
    expect(rotation.usableRefs('deepseek', ['A'])).toEqual(['A'])
    // The expired entry was removed on read; a later read sees no state.
    expect(rotation.usableRefs('deepseek', ['A'])).toEqual(['A'])
  })
})

describe('pickRotationRef', () => {
  it('picks the first non-exhausted ref, preserving configuration order', () => {
    const now = 0
    const rotation = new KeyRotation(() => now)
    rotation.markExhausted('deepseek', 'A', 100, ['A', 'B', 'C'])
    expect(pickRotationRef(rotation, 'deepseek', ['A', 'B', 'C'])).toBe('B')
    rotation.markExhausted('deepseek', 'B', 100, ['A', 'B', 'C'])
    expect(pickRotationRef(rotation, 'deepseek', ['A', 'B', 'C'])).toBe('C')
  })

  it('falls back to the first configured ref when every ref is exhausted', () => {
    const rotation = new KeyRotation()
    rotation.markExhausted('deepseek', 'A', 100, ['A', 'B'])
    rotation.markExhausted('deepseek', 'B', 100, ['A', 'B'])
    expect(pickRotationRef(rotation, 'deepseek', ['A', 'B'])).toBe('A')
  })
})

describe('rotateAfterQuotaFailure', () => {
  it('retires the failed ref and retries while another ref remains usable', () => {
    const rotation = new KeyRotation()
    const decision = rotateAfterQuotaFailure(
      rotation, 'deepseek', quotaFailure('A'), ['A', 'B'], DEFAULT_KEY_COOLDOWN_MS,
    )
    expect(decision).toBe('retry')
    expect(rotation.usableRefs('deepseek', ['A', 'B'])).toEqual(['B'])
  })

  it('stays terminal once every ref is exhausted', () => {
    const rotation = new KeyRotation()
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', quotaFailure('A'), ['A', 'B'], 100)).toBe('retry')
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', quotaFailure('B'), ['A', 'B'], 100)).toBe('terminal')
  })

  it('leaves non-quota failures, unknown refs, and single-key providers terminal', () => {
    const rotation = new KeyRotation()
    const rateLimit = { message: 'rate limited', code: 'RATE_LIMIT', apiKeyRef: 'A' }
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', rateLimit, ['A', 'B'], 100)).toBe('terminal')
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', quotaFailure('FOREIGN'), ['A', 'B'], 100))
      .toBe('terminal')
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', quotaFailure('A'), ['A'], 100)).toBe('terminal')
    expect(rotateAfterQuotaFailure(rotation, 'deepseek', { message: 'limit', code: 'QUOTA' }, ['A', 'B'], 100))
      .toBe('terminal')
  })

  it('marks nothing for a decision that stays terminal', () => {
    const rotation = new KeyRotation()
    rotateAfterQuotaFailure(rotation, 'deepseek', quotaFailure('A'), ['A'], 100)
    expect(rotation.usableRefs('deepseek', ['A'])).toEqual(['A'])
  })
})
