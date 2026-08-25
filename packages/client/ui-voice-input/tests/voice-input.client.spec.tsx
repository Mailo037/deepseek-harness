// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Source-subpath test import: the seat's machine contract is package-internal.
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/contract.ts'
import { zh } from '../src/client/locales.ts'
import {
  resolveSpeechRecognizerFactory, type SpeechRecognizer, type VoiceInputProps,
} from '../src/client/VoiceInput.tsx'
import { VoiceInput } from '../src/client/VoiceInput.tsx'

const sid = (key: string): SessionId => key as SessionId

/** The seat's key domain is the `voice` dictionary; the stub mirrors the real lookup chain. */
const t: VoiceInputProps['t'] = key => (zh as Record<string, string>)[key] ?? key

function inputState(draft = ''): InputState {
  return { draft, attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] }
}

/** One final/interim segment the fake recognizer reports. */
interface Segment {
  transcript: string
  isFinal: boolean
}

/** Test recognizer: records configuration, exposes the event sinks, and never touches a browser engine. */
class FakeRecognizer implements SpeechRecognizer {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: SpeechRecognizer['onresult'] = null
  onerror: SpeechRecognizer['onerror'] = null
  onend: (() => void) | null = null
  start = vi.fn(() => { this.started = true })
  stop = vi.fn()
  abort = vi.fn()
  started = false

  /** Fire one result event carrying the cumulative segment list. */
  emit(segments: readonly Segment[]): void {
    const results = segments.map(segment => ({
      isFinal: segment.isFinal,
      0: { transcript: segment.transcript, confidence: 1 },
      length: 1,
      item: (_index: number) => ({ transcript: segment.transcript, confidence: 1 }),
    })) as unknown as SpeechRecognitionResultList
    this.onresult?.({ results, resultIndex: 0 } as SpeechRecognitionEvent)
  }

  /** Fire one error event. */
  emitError(code: SpeechRecognitionErrorCode): void {
    this.onerror?.({ error: code } as SpeechRecognitionErrorEvent)
  }

  /** Fire the end event (the engine ended, or stop() finalized). */
  end(): void {
    this.onend?.()
  }
}

/** Wire a fake recognizer constructor onto the jsdom window; returns the created instances. */
function stubRecognizer(): { instances: FakeRecognizer[] } {
  const instances: FakeRecognizer[] = []
  // A plain function: the component `new`s the factory, so a vi.fn spy (not
  // constructible) cannot stand in; instance assertions read the array.
  function SpeechRecognitionMock(this: unknown): SpeechRecognizer {
    const instance = new FakeRecognizer()
    instances.push(instance)
    return instance
  }
  vi.stubGlobal('SpeechRecognition', SpeechRecognitionMock)
  return { instances }
}

/** Component harness: a real snapshot store the stub `useInput` subscribes to, plus the full standard-kit props. */
function harness(initial = inputState()) {
  const store = createSnapshotStore<InputState>(initial)
  const actions: InputActions = {
    setDraft: vi.fn((text: string) => {
      const current = store.getSnapshot()
      store.set({ ...current, draft: text, draftRev: current.draftRev + 1 })
    }),
    addAttachments: vi.fn(() => true),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    submit: vi.fn(),
  }
  const useInput: VoiceInputProps['useInput'] = selector =>
    useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
  const props = (overrides: Partial<VoiceInputProps> = {}): VoiceInputProps => ({
    sessionId: sid('s1'),
    // The unused standard kit: inert stubs the component never calls.
    useSession: (() => undefined) as unknown as VoiceInputProps['useSession'],
    useProjection: (() => undefined) as unknown as VoiceInputProps['useProjection'],
    useSessions: (() => undefined) as unknown as VoiceInputProps['useSessions'],
    useWorkspaces: (() => undefined) as unknown as VoiceInputProps['useWorkspaces'],
    useInput,
    inputActions: actions,
    locked: false,
    t,
    ...overrides,
  })
  return { store, actions, props }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VoiceInput seat', () => {
  it('renders nothing when the browser exposes no SpeechRecognition', () => {
    expect(resolveSpeechRecognizerFactory()).toBeUndefined()
    const { props } = harness()
    const { container } = render(<VoiceInput {...props()} />)
    expect(container.querySelector('[data-voice-input]')).toBeNull()
  })

  it('starts dictation on click with the OS-speech configuration and streams final segments into the draft', () => {
    const { instances } = stubRecognizer()
    const { store, props } = harness()
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))

    expect(instances).toHaveLength(1)
    const recognizer = instances[0]!
    expect(recognizer.continuous).toBe(true)
    expect(recognizer.interimResults).toBe(true)
    expect(recognizer.maxAlternatives).toBe(1)
    expect(recognizer.lang).toBe(navigator.language)
    expect(recognizer.started).toBe(true)
    const button = screen.getByRole('button', { name: '停止语音输入' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('data-recording')).toBe('')

    act(() => { recognizer.emit([{ transcript: '你好', isFinal: true }]) })
    expect(store.getSnapshot().draft).toBe('你好')
    // The result list is cumulative: the joined final segments replace the tail.
    act(() => {
      recognizer.emit([
        { transcript: '你好', isFinal: true },
        { transcript: '世界', isFinal: true },
      ])
    })
    expect(store.getSnapshot().draft).toBe('你好 世界')
  })

  it('appends to an existing draft with one separating space', () => {
    const { instances } = stubRecognizer()
    const { store, props } = harness(inputState('前缀'))
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { instances[0]!.emit([{ transcript: '说话', isFinal: true }]) })
    expect(store.getSnapshot().draft).toBe('前缀 说话')
  })

  it('an interim-only event commits nothing (the draft only moves on final segments)', () => {
    const { instances } = stubRecognizer()
    const { store, actions, props } = harness(inputState('已有'))
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { instances[0]!.emit([{ transcript: '半句', isFinal: false }]) })
    expect(store.getSnapshot().draft).toBe('已有')
    expect(actions.setDraft).not.toHaveBeenCalled()
  })

  it('stop keeps the committed transcript and returns the button to idle', () => {
    const { instances } = stubRecognizer()
    const { store, props } = harness()
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { instances[0]!.emit([{ transcript: '定稿', isFinal: true }]) })
    fireEvent.click(screen.getByRole('button', { name: '停止语音输入' }))
    expect(instances[0]!.stop).toHaveBeenCalledTimes(1)

    act(() => { instances[0]!.end() })
    expect(store.getSnapshot().draft).toBe('定稿')
    const button = screen.getByRole('button', { name: '开始语音输入' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('a recognizer error restores the pre-recording draft and announces through the label', () => {
    const { instances } = stubRecognizer()
    const { store, props } = harness(inputState('原始'))
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { instances[0]!.emit([{ transcript: '半成品', isFinal: true }]) })
    expect(store.getSnapshot().draft).toBe('原始 半成品')

    act(() => { instances[0]!.emitError('not-allowed') })
    expect(store.getSnapshot().draft).toBe('原始')
    expect(screen.getByRole('button', { name: '麦克风权限被拒绝，请在浏览器设置中允许' })).toBeDefined()
  })

  it('an aborted error is the user\'s own stop: no announcement, transcript kept', () => {
    const { instances } = stubRecognizer()
    const { store, props } = harness()
    render(<VoiceInput {...props()} />)

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    act(() => { instances[0]!.emit([{ transcript: '保留', isFinal: true }]) })
    act(() => { instances[0]!.emitError('aborted') })
    expect(store.getSnapshot().draft).toBe('保留')
    expect(screen.getByRole('button', { name: '停止语音输入' })).toBeDefined()
  })

  it('is disabled while locked or the input machine is busy', () => {
    stubRecognizer()
    const { props } = harness()
    const view = render(<VoiceInput {...props({ locked: true })} />)
    expect((screen.getByRole('button', { name: '开始语音输入' }) as HTMLButtonElement).disabled).toBe(true)

    view.rerender(<VoiceInput {...props()} />)
    expect((screen.getByRole('button', { name: '开始语音输入' }) as HTMLButtonElement).disabled).toBe(false)

    const { store, props: busyProps } = harness(inputState(''))
    const busyView = render(<VoiceInput {...busyProps()} />)
    act(() => {
      store.set({ ...store.getSnapshot(), phase: 'submitting' })
    })
    expect((within(busyView.container).getByRole('button', { name: '开始语音输入' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a lock while recording aborts the recognizer', () => {
    const { instances } = stubRecognizer()
    const { props } = harness()
    const view = render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))

    view.rerender(<VoiceInput {...props({ locked: true })} />)
    expect(instances[0]!.abort).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: '开始语音输入' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('unmount aborts the recognizer', () => {
    const { instances } = stubRecognizer()
    const { props } = harness()
    const view = render(<VoiceInput {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))

    view.unmount()
    expect(instances[0]!.abort).toHaveBeenCalledTimes(1)
  })

  it('mousedown prevents the default (keeps the textarea focused)', () => {
    stubRecognizer()
    const { props } = harness()
    render(<VoiceInput {...props()} />)
    const button = screen.getByRole('button', { name: '开始语音输入' })
    expect(fireEvent.mouseDown(button)).toBe(false)
  })
})
