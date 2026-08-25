// @vitest-environment jsdom
/**
 * QueueDock rendering and operations: authoritative rows, composer-side
 * editing handoff, drag/keyboard reordering, collapse state, removal,
 * strict steering, failure notices, and live retirement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, QueuedMessage, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QueueItemId } from '../src/client/contract/queue.ts'
import type { InputState } from '../src/client/input/contract.ts'
import { zh } from '../src/client/locales.ts'
import { QueueDock, queueDockEntry, type QueueDockInjected, type QueueDockProps } from '../src/client/queue/QueueDock.tsx'

afterEach(cleanup)

const SID = 's1' as SessionId
const iid = (id: string): QueueItemId => id as QueueItemId
const IMAGE_ATTACHMENT = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const, bytes: 68, width: 1, height: 1,
}

function row(id: string, text: string): QueuedMessage {
  return {
    id: iid(id), messageId: `message-${id}` as never, placement: 'queued',
    content: [{ type: 'text', text }], preview: text, text,
  }
}

function imageRow(id: string, text = ''): QueuedMessage {
  return {
    id: iid(id), messageId: `message-${id}` as never, placement: 'queued',
    content: [
      ...(text === '' ? [] : [{ type: 'text' as const, text }]),
      { type: 'image' as const, attachment: IMAGE_ATTACHMENT },
    ],
    preview: text === '' ? '[image]' : `${text} [image]`, text: null,
  }
}

function snapshotWith(queue: QueuedMessage[]): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue, running: true, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Minimal live source backing the useSession stub. */
function liveSession(initial: ConversationSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => selector(snapshot),
    )
  return {
    useSession,
    push(next: ConversationSnapshot): void {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** InputZone owner stub; `queueEdit` mirrors the shell's published edit state. */
function inputState(queueEdit?: QueueItemId): InputState {
  return {
    draft: '', attachmentIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [],
    ...(queueEdit === undefined ? {} : { queueEdit: { itemId: queueEdit } }),
  }
}

// Standard locale seat stub mirroring the real ns → common → key chain.
const t: QueueDockProps['t'] = makeTranslate(zh, commonZh)

function kitFor(
  snapshot: ConversationSnapshot,
  injected: Partial<QueueDockInjected> = {},
  input = inputState(),
) {
  return {
    sessionId: SID,
    t,
    useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
    useWorkspaces: (() => { throw new Error('unused') }) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => { throw new Error('unused') }) as never,
    inputActions: { setDraft: () => {}, submit: () => {} } as never,
    session: snapshot,
    input,
    updateQueue: vi.fn(() => Promise.resolve()),
    beginQueueEdit: vi.fn(() => true),
    cancelQueueEdit: vi.fn(),
    notify: vi.fn(),
    loadImage: () => new Promise<string>(() => {}),
    ...injected,
  }
}

/** Synthetic DataTransfer stand-in: jsdom drag events carry none. */
const transfer = (): DataTransfer => ({ setData: vi.fn(), effectAllowed: '', dropEffect: '' }) as never

describe('QueueDock', () => {
  it('renders null while the queue is empty', () => {
    const snap = snapshotWith([])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('leaves pending steering to the conversation flow', () => {
    const steering = { ...row('s-1', 'interrupt'), placement: 'steering' as const }
    const snap = snapshotWith([steering])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders one row directly and defaults multiple rows to a collapsible count header', () => {
    const single = snapshotWith([row('i-1', 'one')])
    const source = liveSession(single)
    const view = render(<QueueDock {...kitFor(single)} useSession={source.useSession} />)
    expect(view.queryByRole('button', { name: '1 条排队消息' })).toBeNull()
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([row('i-1', 'one'), row('i-2', 'two')])) })
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBeTruthy()
    expect(view.queryByText('one')).toBeNull()
    expect(view.queryByText('two')).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('one')).toBeTruthy()
    expect(view.getByText('two')).toBeTruthy()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('one')).toBeNull()
  })

  it('renders queued images as inline thumbnails instead of image marker text', async () => {
    const snap = snapshotWith([imageRow('i-image', 'Check this')])
    const loadImage = vi.fn(() => Promise.resolve('blob:queue-image'))
    const view = render(
      <QueueDock {...kitFor(snap, { loadImage })} useSession={liveSession(snap).useSession} />,
    )

    await waitFor(() => {
      expect(view.getByRole('img', { name: '图片' }).getAttribute('src')).toBe('blob:queue-image')
    })
    expect(view.container.textContent).toContain('Check this')
    expect(view.container.textContent).not.toContain('[image]')
    expect(loadImage).toHaveBeenCalledWith(IMAGE_ATTACHMENT)
  })

  it('keeps the strip expanded while the composer edits one of its rows', () => {
    const snap = snapshotWith([row('i-a', 'alpha'), row('i-b', 'beta')])
    const view = render(
      <QueueDock {...kitFor(snap, {}, inputState(iid('i-b')))} useSession={liveSession(snap).useSession} />,
    )
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header).toHaveProperty('disabled', true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('beta').className).toContain('previewEditing')
    expect(view.queryByText('alpha')).toBeTruthy()
  })

  it('hands a row edit to the composer instead of an inline editor', () => {
    const snap = snapshotWith([row('i-edit', 'before')])
    const beginQueueEdit = vi.fn(() => true)
    const view = render(
      <QueueDock {...kitFor(snap, { beginQueueEdit })} useSession={liveSession(snap).useSession} />,
    )

    fireEvent.click(view.getByLabelText('编辑排队消息'))
    expect(beginQueueEdit).toHaveBeenCalledWith(iid('i-edit'))
    // No inline textbox: the composer owns the edited text.
    expect(view.queryByRole('textbox')).toBeNull()
  })

  it('offers the cancel exit on the row loaded into the composer', () => {
    const snap = snapshotWith([row('i-edit', 'before')])
    const cancelQueueEdit = vi.fn()
    const updateQueue = vi.fn(() => Promise.resolve())
    const view = render(
      <QueueDock {...kitFor(snap, { cancelQueueEdit, updateQueue }, inputState(iid('i-edit')))}
        useSession={liveSession(snap).useSession}
      />,
    )

    fireEvent.click(view.getByLabelText('取消编辑'))
    expect(cancelQueueEdit).toHaveBeenCalledOnce()
    expect(view.queryByLabelText('编辑排队消息')).toBeNull()
    expect(updateQueue).not.toHaveBeenCalled()
  })

  it('reorders rows through the drag handle far left of each row', async () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two'), row('i-3', 'three')])
    const updateQueue = vi.fn(() => Promise.resolve())
    const view = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={liveSession(snap).useSession} />,
    )
    fireEvent.click(view.getByRole('button', { name: '3 条排队消息' }))
    const rows = view.container.querySelectorAll('li')
    expect(rows).toHaveLength(3)

    fireEvent.dragStart(rows[0]!, { dataTransfer: transfer() })
    fireEvent.dragOver(rows[2]!, { dataTransfer: transfer() })
    expect(rows[2]!.className).toContain('dropBelow')
    fireEvent.drop(rows[2]!)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-1'), { kind: 'move', toIndex: 2 })
    })
    // The gesture ends with the drop: no lingering indicator.
    expect(rows[2]!.className).not.toContain('dropBelow')
  })

  it('moves a row up when dropped above the source and skips same-position drops', async () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const updateQueue = vi.fn(() => Promise.resolve())
    const view = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={liveSession(snap).useSession} />,
    )
    fireEvent.click(view.getByRole('button', { name: '2 条排队消息' }))
    const rows = view.container.querySelectorAll('li')

    fireEvent.dragStart(rows[1]!, { dataTransfer: transfer() })
    fireEvent.dragOver(rows[0]!, { dataTransfer: transfer() })
    expect(rows[0]!.className).toContain('dropAbove')
    fireEvent.drop(rows[0]!)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-2'), { kind: 'move', toIndex: 0 })
    })

    fireEvent.dragStart(rows[0]!, { dataTransfer: transfer() })
    fireEvent.dragOver(rows[0]!, { dataTransfer: transfer() })
    fireEvent.drop(rows[0]!)
    expect(updateQueue).toHaveBeenCalledOnce()
  })

  it('clears the drag gesture on dragend without mutating the queue', () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const updateQueue = vi.fn(() => Promise.resolve())
    const view = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={liveSession(snap).useSession} />,
    )
    fireEvent.click(view.getByRole('button', { name: '2 条排队消息' }))
    const rows = view.container.querySelectorAll('li')

    fireEvent.dragStart(rows[0]!, { dataTransfer: transfer() })
    fireEvent.dragOver(rows[1]!, { dataTransfer: transfer() })
    fireEvent.dragEnd(rows[0]!)
    fireEvent.drop(rows[1]!)
    expect(updateQueue).not.toHaveBeenCalled()
    expect(rows[1]!.className).not.toContain('dropBelow')
  })

  it('reorders with ArrowUp/ArrowDown on the handle', async () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two'), row('i-3', 'three')])
    const updateQueue = vi.fn(() => Promise.resolve())
    const view = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={liveSession(snap).useSession} />,
    )
    fireEvent.click(view.getByRole('button', { name: '3 条排队消息' }))

    // Re-query per gesture: each op flips busy and rerenders the row. The
    // snapshot fixture never moves, so the middle handle stays the source.
    fireEvent.keyDown(within(view.container).getAllByLabelText('拖动调整发送顺序')[1]!, { key: 'ArrowUp' })
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-2'), { kind: 'move', toIndex: 0 })
    })
    fireEvent.keyDown(within(view.container).getAllByLabelText('拖动调整发送顺序')[1]!, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-2'), { kind: 'move', toIndex: 2 })
    })
    fireEvent.keyDown(within(view.container).getAllByLabelText('拖动调整发送顺序')[1]!, { key: 'Enter' })
    expect(updateQueue).toHaveBeenCalledTimes(2)
  })

  it('reports a failed reorder and keeps the row', async () => {
    const snap = snapshotWith([row('i-race', 'pending'), row('i-2', 'two')])
    const notify = vi.fn()
    const updateQueue = vi.fn(() => Promise.reject(new Error('claimed')))
    const view = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={liveSession(snap).useSession} />,
    )
    fireEvent.click(view.getByRole('button', { name: '2 条排队消息' }))
    fireEvent.keyDown(view.getAllByLabelText('拖动调整发送顺序')[0]!, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('error', '移动失败：这条消息可能已经开始发送。')
    })
    expect(view.getByText('pending')).toBeTruthy()
  })

  it('omits the drag handle for a single row and for subagent queues', () => {
    const single = snapshotWith([row('i-solo', 'only')])
    const solo = render(<QueueDock {...kitFor(single)} useSession={liveSession(single).useSession} />)
    expect(within(solo.container).queryByLabelText('拖动调整发送顺序')).toBeNull()
    expect(within(solo.container).getByText('only')).toBeTruthy()

    const snap = {
      ...snapshotWith([row('i-sub', 'child one'), row('i-sub2', 'child two')]),
      subagent: {
        address: { parentSessionId: 'parent' as SessionId, childSessionId: SID, mode: 'continuable' as const },
        parentAvailable: true,
      },
    }
    const child = render(<QueueDock {...kitFor(snap)} useSession={liveSession(snap).useSession} />)
    fireEvent.click(within(child.container).getByRole('button', { name: '2 条排队消息' }))
    expect(within(child.container).queryByLabelText('拖动调整发送顺序')).toBeNull()
    // Subagent queues render rows read-only: no handle, no actions.
    expect(within(child.container).queryByLabelText('删除排队消息')).toBeNull()
    expect(within(child.container).getByText('child one')).toBeTruthy()
  })

  it('defaults a new multi-row queue to collapsed after the prior queue empties', () => {
    const first = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const source = liveSession(first)
    const view = render(<QueueDock {...kitFor(first)} useSession={source.useSession} />)
    fireEvent.click(view.getByRole('button', { name: '2 条排队消息' }))
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([])) })
    expect(view.container.innerHTML).toBe('')
    act(() => {
      source.push(snapshotWith([row('i-3', 'three'), row('i-4', 'four')]))
    })

    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('three')).toBeNull()
  })

  it('renders active actions and disables editing for mixed-content rows', () => {
    const snap = snapshotWith([
      row('i-1', '第一条排队消息'),
      imageRow('i-2', 'image'),
    ])
    const source = liveSession(snap)
    const { container, getByRole } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    fireEvent.click(getByRole('button', { name: '2 条排队消息' }))
    expect([...container.querySelectorAll('li')].map(item =>
      item.textContent?.replace('拖动调整发送顺序', '').trim(),
    )).toEqual(['第一条排队消息', 'image'])
    expect(container.querySelectorAll('[aria-label="拖动调整发送顺序"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="编辑排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="删除排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="插话发送"]')).toHaveLength(2)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[0] as HTMLButtonElement).disabled).toBe(false)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[1] as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelectorAll('[aria-label="编辑排队消息"]')[1]?.getAttribute('title'))
      .toBe('包含非文本内容，暂不支持编辑')
  })

  it('removes the addressed row', async () => {
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    const source = liveSession(snap)
    const updateQueue = vi.fn(() => Promise.resolve())
    const { getAllByLabelText, getByRole } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByRole('button', { name: '2 条排队消息' }))
    fireEvent.click(getAllByLabelText('删除排队消息')[0]!)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-1'), { kind: 'remove' })
    })
  })

  it('strictly steers complete row content only while the agent is running', async () => {
    const running = snapshotWith([imageRow('i-steer', 'image')])
    const source = liveSession(running)
    const updateQueue = vi.fn(() => Promise.resolve())
    const rendered = render(
      <QueueDock {...kitFor(running, { updateQueue })} useSession={source.useSession} />,
    )

    const button = rendered.getByLabelText('插话发送')
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-steer'), { kind: 'steer' })
    })

    act(() => { source.push({ ...running, running: false }) })
    expect(rendered.getByLabelText('插话发送')).toHaveProperty('disabled', true)
    expect(rendered.getByLabelText('插话发送').getAttribute('title')).toBe('仅运行中可插话发送')
  })

  it('keeps the row and reports a genuine steer failure', async () => {
    const snap = snapshotWith([row('i-steer-race', 'pending steer')])
    const source = liveSession(snap)
    const notify = vi.fn()
    const updateQueue = vi.fn(() => Promise.reject(new Error('transport failed')))
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('插话发送'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'error',
        '插话发送失败，请重试。',
      )
    })
    expect(getByText('pending steer')).toBeTruthy()
  })

  it('keeps the row and surfaces a notice when an operation loses the claim race', async () => {
    const snap = snapshotWith([row('i-race', 'pending')])
    const source = liveSession(snap)
    const notify = vi.fn()
    const updateQueue = vi.fn(() => Promise.reject(new Error('not found')))
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('删除排队消息'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('error', '删除失败：这条消息可能已经开始发送。')
    })
    expect(getByText('pending')).toBeTruthy()
  })

  it('follows authoritative retirement back to null', () => {
    const snap = snapshotWith([row('i-1', '在场')])
    const source = liveSession(snap)
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.textContent).toContain('在场')
    act(() => { source.push(snapshotWith([])) })
    expect(container.innerHTML).toBe('')
  })

  it('registers as the terminal composer-context entry', () => {
    expect(queueDockEntry.name).toBe('conversation-queue-dock')
    expect(queueDockEntry.inject).toEqual(['slots', 'conversation', 'sessions'])
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    queueDockEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.dock', id: 'queue', order: 20 }),
      QueueDock,
    )
  })
})
