// @vitest-environment jsdom
/** LaunchRow behavior: hidden without a Host namespace, switch follows the
 * store mirror, clicks drive the injected face. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  createSnapshotStore, type SessionListState, type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LaunchRow } from '../src/client/LaunchRow.tsx'
import type { LaunchRowComponentProps } from '../src/client/LaunchRow.tsx'
import { createLaunchRowStore } from '../src/client/store.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'launch.title': 'Start at computer startup',
  'launch.enable': 'Launch Harness automatically when the computer starts',
  'launch.hint': "The switch registers or removes this Harness installation's system login launch entry; the DeepSeekHarness entry it manages is its own.",
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(available: boolean, launchAtLogin = false) {
  const store = createLaunchRowStore().create()
  act(() => {
    store.actions.sync({ launchAtLogin, available, writable: true, revision: 0 })
  })
  const setLaunchAtLogin = vi.fn()
  const props: LaunchRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setLaunchAtLogin,
  }
  render(<LaunchRow {...props} />)
  return { store, setLaunchAtLogin }
}

describe('LaunchRow', () => {
  it('renders nothing where the Host serves no launch namespace', () => {
    mount(false)
    expect(screen.queryByText('Start at computer startup')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('renders title, switch, and hint where the namespace is served', () => {
    mount(true)
    expect(screen.getByText('Start at computer startup')).toBeDefined()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(COPY['launch.hint']!)).toBeDefined()
  })

  it('switch click drives setLaunchAtLogin with the negated value', () => {
    const b = mount(true, true)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    expect(b.setLaunchAtLogin).toHaveBeenCalledWith(false)
  })

  it('store sync moves the switch without further clicks', () => {
    const b = mount(true, false)
    act(() => {
      b.store.actions.sync({ launchAtLogin: true, available: true, writable: true, revision: 1 })
    })
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
  })
})
