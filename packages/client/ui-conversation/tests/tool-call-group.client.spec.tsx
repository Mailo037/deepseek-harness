// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ToolCallGroup } from '../src/client/chat/ToolCallGroup.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ToolCallGroup phone sheet', () => {
  it('opens the grouped tool rows in a bottom sheet on a phone viewport', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === '(max-width: 639px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    vi.stubGlobal('matchMedia', matchMedia)
    vi.useFakeTimers()
    try {
      const view = render(
        <ToolCallGroup icon={<span>i</span>} label="Bash" active={false} closeLabel="Close">
          <button type="button" data-testid="row">Run ls</button>
        </ToolCallGroup>,
      )
      const header = view.getByRole('button', { name: /Bash/ })
      fireEvent.click(header)

      // The window body does not expand inline: no scroll group in the row.
      expect(view.container.querySelector('[data-tool-scroll]')).toBeNull()
      // The group rows open in the bottom-sheet dialog (portaled to the body).
      const dialog = screen.getByRole('dialog', { name: 'Bash' })
      expect(within(dialog).getByTestId('row')).toBeTruthy()

      // The sheet's close button slides it down, then it unmounts.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      expect(screen.getByRole('dialog', { name: 'Bash' })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(240) })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
