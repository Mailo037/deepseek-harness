// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import type { ArchiveNotification } from '../src/client/ArchiveNotificationStack.tsx'
import { ArchiveNotificationStack } from '../src/client/ArchiveNotificationStack.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as WorkspaceBrowserProps['t']
const sid = (id: string) => id as SessionId

const notice = (id: number, sessionId: string): ArchiveNotification => ({ id, sessionId: sid(sessionId), kind: 'archived' })
const failure = (id: number, sessionId: string): ArchiveNotification => ({
  id, sessionId: sid(sessionId), kind: 'archive-failure', message: 'boom',
})

// Fresh callbacks per test: assertions count calls, so shared mocks would leak.
const makeProps = () => ({
  pendingIds: new Set<number>(),
  onDismiss: vi.fn(),
  onUndo: vi.fn(),
  onRetryArchive: vi.fn(),
  onRetryRestore: vi.fn(),
  t,
})

describe('ArchiveNotificationStack', () => {
  it('keeps the single newest card actionable without an expand affordance', () => {
    const props = makeProps()
    render(<ArchiveNotificationStack {...props} notifications={[notice(1, 'a')]} />)
    expect(screen.getByLabelText('归档通知').getAttribute('aria-expanded')).toBeNull()
    expect(screen.getByLabelText('归档通知').getAttribute('tabindex')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(props.onUndo).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('a') }))
  })

  it('expands only on a stack click and exposes the expanded state', async () => {
    const props = makeProps()
    const view = render(<ArchiveNotificationStack {...props} notifications={[notice(2, 'b'), notice(1, 'a')]} />)
    const stack = screen.getByLabelText('归档通知')
    expect(stack.getAttribute('aria-expanded')).toBe('false')
    // Hover and focus must not expand; only a click on a non-button area does.
    fireEvent.mouseEnter(stack)
    fireEvent.focus(stack)
    expect(stack.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(stack)
    expect(stack.getAttribute('aria-expanded')).toBe('true')
    // The older card's Undo becomes reachable only while expanded.
    await screen.findAllByRole('button', { name: '撤销' })
    fireEvent.click(screen.getAllByRole('button', { name: '撤销' })[0]!)
    expect(props.onUndo).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('a') }))
    // A second click on a button never collapses.
    fireEvent.click(screen.getAllByRole('button', { name: '关闭通知' })[0]!)
    expect(stack.getAttribute('aria-expanded')).toBe('true')
    view.unmount()
    expect(props.onDismiss).toHaveBeenCalledWith(1)
  })

  it('collapses on Escape, outside pointerdown, and when cards drop below two', async () => {
    const props = makeProps()
    const view = render(<ArchiveNotificationStack {...props} notifications={[notice(3, 'c'), notice(1, 'a')]} />)
    const stack = screen.getByLabelText('归档通知')
    fireEvent.click(stack)
    expect(stack.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(stack, { key: 'Escape' })
    expect(stack.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(stack)
    fireEvent.pointerDown(document.body)
    await Promise.resolve()
    expect(stack.getAttribute('aria-expanded')).toBe('false')

    // A keyboard activation on the stack itself toggles like a click...
    fireEvent.keyDown(stack, { key: 'Enter' })
    expect(stack.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(stack, { key: ' ', code: 'Space' })
    expect(stack.getAttribute('aria-expanded')).toBe('false')

    // ...and dropping to one card auto-collapses for a later third card.
    fireEvent.click(stack)
    expect(stack.getAttribute('aria-expanded')).toBe('true')
    view.rerender(<ArchiveNotificationStack {...props} notifications={[notice(3, 'c')]} />)
    expect(stack.getAttribute('aria-expanded')).toBeNull()
    view.unmount()
    expect(props.onUndo).not.toHaveBeenCalled()
  })

  it('retries archive and restore failures through their own callbacks', async () => {
    const props = makeProps()
    render(
      <ArchiveNotificationStack
        {...props}
        notifications={[failure(4, 'd'), { ...failure(5, 'e'), kind: 'restore-failure', message: 'boom' }]}
      />,
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[1]!)
    expect(props.onRetryArchive).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('d') }))
    expect(props.onRetryRestore).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sid('e') }))
  })

  it('disables actions while their request is pending', () => {
    const props = makeProps()
    render(
      <ArchiveNotificationStack
        {...props}
        pendingIds={new Set([6])}
        notifications={[{ ...failure(6, 'f'), kind: 'restore-failure', message: 'boom' }]}
      />,
    )
    expect(screen.getByRole('button', { name: '处理中…' }).hasAttribute('disabled')).toBe(true)
    expect(props.onRetryRestore).not.toHaveBeenCalled()
  })
})
