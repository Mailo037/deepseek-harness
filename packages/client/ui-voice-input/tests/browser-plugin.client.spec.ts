/**
 * ui-voice-input browser half on a real SlotRegistry: the plugin occupies
 * the conversation-declared `conversation.input.voice` single seat with the
 * dictation mic; teardown empties the seat (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { VoiceInput } from '../src/client/VoiceInput.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.voice': { kind: 'single', scope: 'session' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots }
}

describe('ui-voice-input browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers the mic seat and unregisters on teardown (HMR safety)', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.voice')[0]
    expect(entry?.component).toBe(VoiceInput)

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.voice')).toHaveLength(0)
  })
})
