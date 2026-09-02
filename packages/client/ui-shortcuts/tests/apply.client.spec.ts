// @vitest-environment jsdom
/**
 * Apply-level spec for the global keyboard shortcut plugin: the keydown
 * listener drives the correct service calls, respects IME compositions and
 * repeats, and is removed on fiber disposal.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-shortcuts/client'

interface LayoutFake {
  toggleSidebar: ReturnType<typeof vi.fn>
  openDetails: ReturnType<typeof vi.fn>
  closeDetails: ReturnType<typeof vi.fn>
}

interface WorkspacesFake {
  startSession: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  rename: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  insertSessionBefore: ReturnType<typeof vi.fn>
  deleteSession: ReturnType<typeof vi.fn>
  deleteArchivedSessions: ReturnType<typeof vi.fn>
}

function bench(): { ctx: Context; layout: LayoutFake; workspaces: WorkspacesFake } {
  const ctx = new Context()
  const layout: LayoutFake = {
    toggleSidebar: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
  }
  const workspaces: WorkspacesFake = {
    startSession: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    insertSessionBefore: vi.fn(),
    deleteSession: vi.fn(),
    deleteArchivedSessions: vi.fn(),
  }
  ctx.provide('layout', layout as never)
  ctx.provide('workspaces', workspaces as never)
  return { ctx, layout, workspaces }
}

function keydown(overrides: Partial<KeyboardEventInit> = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'b',
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  }))
}

describe('ui-shortcuts apply', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['layout', 'workspaces'])
  })

  it('toggles the sidebar on Ctrl+B', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', ctrlKey: true })
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('toggles the sidebar on Cmd+B', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', metaKey: true })
    expect(layout.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('starts a new session on Ctrl+Shift+S', async () => {
    const { ctx, workspaces } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 's', ctrlKey: true, shiftKey: true })
    expect(workspaces.startSession).toHaveBeenCalledTimes(1)
  })

  it('starts a new session on Cmd+Shift+S', async () => {
    const { ctx, workspaces } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 's', metaKey: true, shiftKey: true })
    expect(workspaces.startSession).toHaveBeenCalledTimes(1)
  })

  it('does not react to Ctrl+S without Shift', async () => {
    const { ctx, layout, workspaces } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 's', ctrlKey: true, shiftKey: false })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
    expect(workspaces.startSession).not.toHaveBeenCalled()
  })

  it('does not react to plain b without a modifier', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', ctrlKey: false, metaKey: false })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('does not react to Ctrl+Alt+B', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', ctrlKey: true, altKey: true })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('skips defaultPrevented events', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })
    Object.defineProperty(event, 'defaultPrevented', { value: true })
    document.dispatchEvent(event)
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('skips IME composition events', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', ctrlKey: true, isComposing: true })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('skips keyCode 229 (legacy IME)', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    // keyCode 229 is the legacy IME-composition signal
    // oxlint-disable-next-line typescript/no-deprecated -- exercises the legacy IME compatibility path
    const event = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, keyCode: 229 })
    document.dispatchEvent(event)
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('skips repeated events', async () => {
    const { ctx, layout } = bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    keydown({ key: 'b', ctrlKey: true, repeat: true })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })

  it('removes the listener on fiber disposal', async () => {
    const { ctx, layout } = bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    keydown({ key: 'b', ctrlKey: true })
    expect(layout.toggleSidebar).not.toHaveBeenCalled()
  })
})
