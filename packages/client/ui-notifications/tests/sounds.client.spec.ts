/** Sound synthesis: voice counts and shapes per built-in sound, recorded
 * through a fake AudioContext; the production player is a silent no-op where
 * WebAudio does not exist. */
import { describe, expect, it, vi } from 'vitest'
import { createPlayerWith, createWebAudioPlayer } from '../src/client/sounds.ts'

interface Voice {
  readonly type: OscillatorType | undefined
  readonly freq: number
}

/** Minimal AudioContext double recording one entry per started oscillator. */
function fakeContext() {
  const voices: Voice[] = []
  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })
  const ctx = {
    currentTime: 5,
    destination: {},
    createOscillator: () => {
      const osc = {
        type: undefined as OscillatorType | undefined,
        frequency: makeParam(),
        connect: vi.fn(),
        start: vi.fn(() => { voices.push({ type: osc.type, freq: osc.frequency.value }) }),
        stop: vi.fn(),
      }
      return osc
    },
    createGain: () => ({
      gain: makeParam(),
      connect: vi.fn(),
    }),
  }
  return { ctx: ctx as unknown as AudioContext, voices }
}

describe('sound synthesis', () => {
  it('schedules one voice per tone of the chosen sound', () => {
    const fake = fakeContext()
    const play = createPlayerWith(() => fake.ctx)
    play('ping')
    expect(fake.voices).toHaveLength(1)
    play('chime')
    expect(fake.voices).toHaveLength(3)
    play('pulse')
    expect(fake.voices).toHaveLength(6)
    play('bell')
    expect(fake.voices).toHaveLength(8)
  })

  it('shapes the error pulse as descending triangle blips', () => {
    const fake = fakeContext()
    const play = createPlayerWith(() => fake.ctx)
    play('pulse')
    expect(fake.voices.map(v => v.type)).toEqual(['triangle', 'triangle', 'triangle'])
    expect(fake.voices.map(v => v.freq)).toEqual([660, 520, 392])
  })

  it('reuses one context across plays', () => {
    const factory = vi.fn(() => fakeContext().ctx)
    const play = createPlayerWith(factory)
    play('chime')
    play('chime')
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('production player stays silent without a global AudioContext', () => {
    const play = createWebAudioPlayer()
    expect(() => play('chime')).not.toThrow()
  })
})
