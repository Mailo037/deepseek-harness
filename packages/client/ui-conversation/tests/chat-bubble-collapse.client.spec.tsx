// @vitest-environment jsdom
// User bubble show-more disclosure (ClampableBubbleBody): an over-tall
// message clamps behind a gradient with one toggle; a short one renders
// bare, and a content change re-measures. jsdom has no layout engine, so
// scrollHeight is stubbed on the HTMLElement prototype for the suite.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { zh } from '../src/client/locales.ts'

const t: ChatNodeViewProps['t'] = makeTranslate(zh, commonZh)
const renderMessageImages = (): null => null

/** The height every element reports while the stub is installed. */
let measuredHeight = 0

beforeEach(() => {
  // jsdom leaves scrollHeight at 0; shadow the inherited accessor for the
  // measurement the component reads in its layout effect.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return measuredHeight },
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
  cleanup()
})

function userProps(text: string): ChatNodeViewProps<'user'> {
  return {
    node: {
      key: 'fixture:user:1',
      kind: 'user',
      id: '1',
      target: 'chat',
      anchorSeq: 1,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        kind: 'user',
        seq: 1,
        time: 1_000,
        content: [{ type: 'text', text }] as never,
        source: null,
      },
    },
    t,
    renderMessageImages,
  } as unknown as ChatNodeViewProps<'user'>
}

describe('user bubble show-more disclosure', () => {
  it('renders a short bubble bare: no clamp attribute and no toggle', () => {
    measuredHeight = 48
    render(<UserMessageNodeView {...userProps('kurze Frage')} />)
    expect(screen.queryByText('显示更多')).toBeNull()
    expect(document.querySelector('[data-clamped]')).toBeNull()
  })

  it('clamps an over-tall bubble behind a toggle that expands and re-clamps', () => {
    measuredHeight = 600
    render(<UserMessageNodeView {...userProps(Array.from({ length: 40 }, (_, i) => `Zeile ${i}`).join('\n'))} />)
    const clamped = document.querySelector('[data-clamped]')
    expect(clamped).not.toBeNull()
    const toggle = screen.getByRole('button', { name: '显示更多' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)
    expect(document.querySelector('[data-clamped]')).toBeNull()
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(document.querySelector('[data-clamped]')).not.toBeNull()
    expect(screen.getByRole('button', { name: '显示更多' })).toBeTruthy()
  })

  it('re-measures when the content changes and drops the toggle once it fits', () => {
    measuredHeight = 600
    const view = render(<UserMessageNodeView {...userProps(Array.from({ length: 40 }, (_, i) => `Zeile ${i}`).join('\n'))} />)
    expect(screen.getByRole('button', { name: '显示更多' })).toBeTruthy()

    measuredHeight = 48
    view.rerender(<UserMessageNodeView {...userProps('jetzt kurz')} />)
    expect(screen.queryByRole('button', { name: '显示更多' })).toBeNull()
    expect(document.querySelector('[data-clamped]')).toBeNull()
  })
})
