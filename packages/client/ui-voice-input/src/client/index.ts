/**
 * Voice input plugin, browser half: the composer's named
 * `conversation.input.voice` seat. One contribution — the dictation mic
 * between the model select and the send button — fed entirely by the
 * session standard kit (useInput / inputActions) and the browser's
 * SpeechRecognition API; the seat renders nothing when no recognizer exists.
 */
// Type-only: pulls the ui-conversation SlotMap merge (the input.voice seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { VoiceInput } from './VoiceInput.tsx'
import { en, zh, type VoiceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer voice-input surface copy. */
    voice: VoiceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'voice'

/** Required services: the slot registry and locale. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the `voice` dictionaries, then register the
 * composer voice seat over the ui-conversation declaration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-input: dictionaries')

  ctx.inject(['slots'], (scope: ClientContext) => {
    scope.slots.inject('conversation.input.voice', () => scope.slots.register({
      name: 'conversation.input.voice',
      locale: NS,
    }, VoiceInput))
  })
}
