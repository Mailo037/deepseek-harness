// @vitest-environment jsdom
// Session-header more-options entry: blank sessions render nothing; the menu
// dispatches fork/archive/download directly, rename through its dialog, and
// move with the preselected first workspace. Without an injected download
// callback the menu drops the download row.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId, SessionListState, WorkspaceId, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionLogDownloadState } from '@deepseek-ai/dsh-session-log-export/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionOptionsActionProps } from '../src/client/contract/slots.ts'
import { SessionOptionsAction } from '../src/client/SessionOptionsAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const workspacesState: WorkspaceListState = {
  items: [
    { workspaceId: wid('ws-a'), path: '/a', title: 'Alpha', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { workspaceId: wid('ws-b'), path: '/b', title: 'Beta', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ],
  archivedSessionIds: [],
  pinnedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
  baselinesReady: true,
  recentWorkspaceId: undefined,
}

function sessionsState(blank: boolean): SessionListState {
  const id = sid('s-1')
  return {
    ids: [id],
    byId: {
      [id]: {
        id, displayTitle: 'Aktueller Chat', title: 'Aktueller Chat', blank,
        running: false, updatedAt: 1,
      },
    },
    current: id,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState
}

interface Harness {
  renameSession: ReturnType<typeof vi.fn>
  forkSession: ReturnType<typeof vi.fn>
  archiveSession: ReturnType<typeof vi.fn>
  setSessionPinned: ReturnType<typeof vi.fn>
  moveSession: ReturnType<typeof vi.fn>
  downloadSessionLog: ReturnType<typeof vi.fn>
}

function mount(blank = false, options: { download?: boolean; downloading?: boolean } = {}): Harness {
  const sessionsStore = createSnapshotStore(sessionsState(blank))
  const workspacesStore = createSnapshotStore(workspacesState)
  const downloadState: SessionLogDownloadState = {
    bySession: options.downloading === true ? { 's-1': { open: true, status: 'downloading', error: null } } : {},
  }
  const downloadStore = createSnapshotStore(downloadState)
  const harness: Harness = {
    renameSession: vi.fn().mockResolvedValue(undefined),
    forkSession: vi.fn(),
    archiveSession: vi.fn().mockResolvedValue(undefined),
    setSessionPinned: vi.fn().mockResolvedValue(undefined),
    moveSession: vi.fn().mockResolvedValue(undefined),
    downloadSessionLog: vi.fn(),
  }
  const props = {
    sessionId: sid('s-1'),
    useSessions: bindSnapshotSelector(sessionsStore),
    useWorkspaces: bindSnapshotSelector(workspacesStore),
    useSessionLogDownload: bindSnapshotSelector(downloadStore),
    renderSlot: ((key: string) => key === 'conversation.session.header.utilities.menuHead'
      ? <div data-testid="menu-head">Standard mode</div>
      : null) as unknown as SessionOptionsActionProps['renderSlot'],
    t,
    ...(options.download === false ? {} : harness),
  } as unknown as SessionOptionsActionProps
  render(<SessionOptionsAction {...props} />)
  return harness
}

describe('SessionOptionsAction', () => {
  it('renders nothing for a blank provisional session', () => {
    mount(true)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the verb menu and dispatches pin, fork, and archive directly', () => {
    const harness = mount()
    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    // The menu head renders pinned above the verb rows (menu-head hole).
    expect(screen.getByTestId('menu-head').parentElement?.className).toMatch(/menuHead/)
    expect(screen.getByRole('menuitem', { name: '重命名' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '分叉会话' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '移动会话…' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '下载会话日志' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '归档会话' }).className).toMatch(/danger/)

    fireEvent.click(screen.getByRole('menuitem', { name: '固定会话' }))
    expect(harness.setSessionPinned).toHaveBeenCalledWith(sid('s-1'), true)

    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '分叉会话' }))
    expect(harness.forkSession).toHaveBeenCalledWith(sid('s-1'))

    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '归档会话' }))
    expect(harness.archiveSession).toHaveBeenCalledWith(sid('s-1'))
    expect(harness.renameSession).not.toHaveBeenCalled()
  })

  it('renames through the dialog with the trimmed draft', async () => {
    const harness = mount()
    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText('会话名称') as HTMLInputElement
    expect(input.value).toBe('Aktueller Chat')
    fireEvent.change(input, { target: { value: '  Neuer Titel  ' } })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    await vi.waitFor(() => {
      expect(harness.renameSession).toHaveBeenCalledWith(sid('s-1'), 'Neuer Titel')
    })
  })

  it('moves with the preselected first workspace', async () => {
    const harness = mount()
    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移动会话…' }))
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    await vi.waitFor(() => {
      expect(harness.moveSession).toHaveBeenCalledWith(sid('s-1'), wid('ws-a'))
    })
  })

  it('starts the log download through the injected callback and disables the row while in flight', () => {
    const harness = mount(false, { downloading: true })
    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    const row = screen.getByRole('menuitem', { name: '下载会话日志' }) as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(harness.downloadSessionLog).not.toHaveBeenCalled()

    fireEvent.click(row)
    expect(harness.downloadSessionLog).not.toHaveBeenCalled()
  })

  it('drops the download row when no download callback is injected', () => {
    mount(false, { download: false })
    fireEvent.click(screen.getByRole('button', { name: '会话“Aktueller Chat”的操作' }))
    expect(screen.queryByRole('menuitem', { name: '下载会话日志' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: '归档会话' })).toBeTruthy()
  })
})
