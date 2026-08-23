/**
 * Built-in notification sounds, synthesized with the Web Audio API — no audio
 * assets ship with the bundle. One factory owns the lazily-created
 * `AudioContext`; every play builds short oscillator + gain envelopes and
 * never keeps nodes past their stop time.
 */
import type { NotificationSound } from '../notification-settings.ts'

/** AudioContext constructor face (injectable so tests can record scheduling). */
export type AudioContextFactory = () => AudioContext

/** Plays one built-in sound; a no-op when no AudioContext exists (node runs). */
export type SoundPlayer = (id: NotificationSound) => void

/** Envelope parameters for one synthesized tone. */
interface Tone {
  /** Oscillator frequency in Hz. */
  freq: number
  /** Seconds after context-now when the tone starts. */
  at: number
  /** Audible seconds from onset to silence. */
  duration: number
  /** Peak gain (linear ramp up, exponential decay down). */
  peak?: number
  /** Oscillator wave shape. */
  type?: OscillatorType
}

const SOUNDS: Record<NotificationSound, readonly Tone[]> = {
  // Two ascending sines: "something finished well".
  chime: [
    { freq: 1046.5, at: 0, duration: 0.5 },
    { freq: 1318.5, at: 0.12, duration: 0.55, peak: 0.16 },
  ],
  // One short clean sine: neutral nudge.
  ping: [
    { freq: 880, at: 0, duration: 0.3, peak: 0.2 },
  ],
  // Fundamental plus an inharmonic partial with a long ring: attention without harshness.
  bell: [
    { freq: 1568, at: 0, duration: 1.1, peak: 0.14 },
    { freq: 1568 * 2.756, at: 0, duration: 0.5, peak: 0.05 },
  ],
  // Three quick descending triangle blips: something needs fixing.
  pulse: [
    { freq: 660, at: 0, duration: 0.12, type: 'triangle' },
    { freq: 520, at: 0.11, duration: 0.12, type: 'triangle' },
    { freq: 392, at: 0.22, duration: 0.16, type: 'triangle' },
  ],
}

function scheduleTone(ctx: AudioContext, tone: Tone): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const t0 = ctx.currentTime + tone.at
  osc.type = tone.type ?? 'sine'
  osc.frequency.value = tone.freq
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(tone.peak ?? 0.18, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + tone.duration + 0.05)
}

/**
 * The production sound player: one shared AudioContext, created on first play
 * (browsers require it anyway) and resumed when suspended. A denied resume or
 * missing WebAudio support stays silent instead of throwing — notifications
 * are enhancement, never load-bearing.
 * @returns the player.
 */
export function createWebAudioPlayer(): SoundPlayer {
  let ctx: AudioContext | undefined
  return (id) => {
    if (ctx === undefined) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      if (Ctor === undefined) return
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    for (const tone of SOUNDS[id]) scheduleTone(ctx, tone)
  }
}

/**
 * Test/diagnostic player over an injected factory.
 * @param factory - AudioContext supplier invoked on first play.
 * @returns the player.
 */
export function createPlayerWith(factory: AudioContextFactory): SoundPlayer {
  let ctx: AudioContext | undefined
  return (id) => {
    if (ctx === undefined) ctx = factory()
    for (const tone of SOUNDS[id]) scheduleTone(ctx, tone)
  }
}
