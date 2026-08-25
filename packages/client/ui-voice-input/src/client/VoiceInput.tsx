/**
 * VoiceInput: the composer's named voice seat (`conversation.input.voice`),
 * between the model select and the send button. One icon-only mic button —
 * no outline, no background. Click starts the browser's SpeechRecognition
 * (the OS speech platform on Windows/Edge), click again stops; final
 * segments stream into the composer draft while recording. A recognizer
 * error restores the pre-recording draft and surfaces through the tooltip.
 * The seat renders nothing when the browser exposes no recognizer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { IconMicFill16, IconMicOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the SlotMap merge that names the `conversation.input.voice` seat
// and the session standard kit (useInput / inputActions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VoiceKey } from './locales.ts'
import css from './VoiceInput.module.css'

/**
 * Minimal structural face of the browser SpeechRecognition class — lib.dom
 * types the event payloads but not the recognizer itself.
 */
export interface SpeechRecognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Constructor for one recognizer instance (unprefixed or webkit). */
export type SpeechRecognizerFactory = new () => SpeechRecognizer

/** Resolve the browser's speech recognition constructor, if any. */
export function resolveSpeechRecognizerFactory(): SpeechRecognizerFactory | undefined {
  const w = window as {
    SpeechRecognition?: SpeechRecognizerFactory
    webkitSpeechRecognition?: SpeechRecognizerFactory
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? undefined
}

/** Map a recognizer error code onto the `voice` dictionary key. */
const ERROR_KEYS: Partial<Record<SpeechRecognitionErrorCode, VoiceKey>> = {
  'no-speech': 'voice.error.noSpeech',
  'audio-capture': 'voice.error.audioCapture',
  'not-allowed': 'voice.error.notAllowed',
  'network': 'voice.error.network',
  'service-not-allowed': 'voice.error.serviceNotAllowed',
  'language-not-supported': 'voice.error.languageNotSupported',
  'phrases-not-supported': 'voice.error.phrasesNotSupported',
}

function errorKeyOf(code: SpeechRecognitionErrorCode): VoiceKey {
  const key = ERROR_KEYS[code]
  /* v8 ignore next -- the browser never produces an unrecognised code; the fallback satisfies TS's type-guarded exhaustiveness */
  return key ?? 'voice.error.unknown'
}

/** Full voice-seat props: the owner `locked` share, the session standard kit, and the locale seat. */
export type VoiceInputProps = PropsRuntime<'conversation.input.voice'> & PropsLocale<'voice'>

export function VoiceInput({ locked, useInput, inputActions, t }: VoiceInputProps) {
  const factory = useMemo(resolveSpeechRecognizerFactory, [])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  const baseDraftRef = useRef('')
  const draftRef = useRef('')
  const draft = useInput(s => s.draft)
  const phase = useInput(s => s.phase)
  // Event handlers read the draft after renders; the ref mirrors it.
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const startRecording = useCallback((): void => {
    /* v8 ignore next -- unreachable: the render guard hides the button when no recognizer exists */
    if (factory === undefined) return
    setError(null)
    baseDraftRef.current = draftRef.current
    const recognizer = new factory()
    recognizer.lang = navigator.language
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.maxAlternatives = 1
    // Each result event carries the session's cumulative result list; the
    // final segments joined in order are the committed transcript so far.
    recognizer.onresult = (event: SpeechRecognitionEvent): void => {
      const finals: string[] = []
      for (const result of Array.from(event.results)) {
        const best = result[0]
        /* v8 ignore next -- a zero-alternative result violates the SpeechRecognition contract (maxAlternatives 1) */
        if (best === undefined) continue
        if (result.isFinal) finals.push(best.transcript)
      }
      if (finals.length === 0) return // interim-only event: nothing committed yet
      const transcript = finals.join(' ')
      const base = baseDraftRef.current
      const joined = base.length === 0 || base.endsWith(' ') || transcript.startsWith(' ')
        ? base + transcript
        : `${base} ${transcript}`
      inputActions.setDraft(joined)
    }
    recognizer.onerror = (event: SpeechRecognitionErrorEvent): void => {
      // `aborted` is the user's own stop (unmount, lock, teardown): the
      // committed transcript stays in the draft and no error is announced.
      if (event.error === 'aborted') return
      setError(t(errorKeyOf(event.error)))
      inputActions.setDraft(baseDraftRef.current)
    }
    recognizer.onend = (): void => {
      setRecording(false)
    }
    recognizerRef.current = recognizer
    recognizer.start()
    setRecording(true)
  }, [factory, inputActions, t])

  const stopRecording = useCallback((): void => {
    // stop() finalizes pending speech, keeps the transcript, then fires onend.
    recognizerRef.current?.stop()
  }, [])

  const onToggle = (): void => {
    if (recording) stopRecording()
    else startRecording()
  }

  // Teardown: a recognizer must never outlive the component.
  useEffect(() => () => {
    recognizerRef.current?.abort()
    recognizerRef.current = null
  }, [])

  // A session-side lock (removed / inert / blocked) ends recording; the
  // draft is left where it is — the lock is not an error to roll back.
  useEffect(() => {
    if (!locked) return
    recognizerRef.current?.abort()
    recognizerRef.current = null
    setRecording(false)
  }, [locked])

  if (factory === undefined) return null
  const busy = phase !== 'plain'
  const label = error ?? (recording ? t('voice.stop') : t('voice.start'))
  return (
    <Tooltip label={label} side="top" delayMs={500}>
      <button
        type="button"
        className={recording ? `${css.mic} ${css.recording}` : css.mic}
        aria-label={label}
        aria-pressed={recording}
        data-voice-input
        data-recording={recording ? '' : undefined}
        // Recording keeps the button live so the user can always stop; the
        // lock effect above aborts an active session immediately.
        disabled={!recording && (locked || busy)}
        // Keep the textarea's focus: the mic must not steal it mid-typing.
        onMouseDown={(e: MouseEvent<HTMLButtonElement>) => { e.preventDefault() }}
        onClick={onToggle}
      >
        {recording ? <IconMicFill16 size={16} /> : <IconMicOutline16 size={16} />}
      </button>
    </Tooltip>
  )
}
