import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GRACE_MS, GraceTimer } from '../src/grace.ts'

describe('GraceTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after the configured window', () => {
    const fired: string[] = []
    const timer = new GraceTimer(() => { fired.push('fire') })
    timer.start(DEFAULT_GRACE_MS)
    expect(timer.pending).toBe(true)
    expect(fired).toEqual([])
    vi.advanceTimersByTime(DEFAULT_GRACE_MS - 1)
    expect(fired).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fired).toEqual(['fire'])
    expect(timer.pending).toBe(false)
  })

  it('does not fire after cancel', () => {
    const fired: string[] = []
    const timer = new GraceTimer(() => { fired.push('fire') })
    timer.start(DEFAULT_GRACE_MS)
    timer.cancel()
    expect(timer.pending).toBe(false)
    vi.advanceTimersByTime(DEFAULT_GRACE_MS)
    expect(fired).toEqual([])
  })

  it('replaces an earlier timer when start is called again', () => {
    const fired: string[] = []
    const timer = new GraceTimer(() => { fired.push('fire') })
    timer.start(1000)
    timer.start(5000)
    vi.advanceTimersByTime(1000)
    // The first timer (1000) was replaced and should not fire.
    expect(fired).toEqual([])
    vi.advanceTimersByTime(4000)
    expect(fired).toEqual(['fire'])
  })

  it('fires immediately on expire()', () => {
    const fired: string[] = []
    const timer = new GraceTimer(() => { fired.push('fire') })
    timer.start(5000)
    expect(timer.pending).toBe(true)
    timer.fire()
    expect(timer.pending).toBe(false)
    expect(fired).toEqual(['fire'])
  })
})
