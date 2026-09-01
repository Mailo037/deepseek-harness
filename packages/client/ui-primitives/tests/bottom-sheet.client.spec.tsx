// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../src/BottomSheet.tsx'

afterEach(cleanup)

function renderSheet(overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const onClose = vi.fn()
  const view = render(
    <BottomSheet open onClose={onClose} title="Output" {...overrides}>
      <span>body</span>
    </BottomSheet>,
  )
  return { onClose, view }
}

/** The sheet's presentation root (parent of the dialog). */
function rootOf(): HTMLElement {
  return screen.getByRole('dialog').parentElement as HTMLElement
}

describe('BottomSheet', () => {
  it('renders the mask, title, close button, and body while open', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Output' })).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
    expect(screen.getByLabelText('Close')).toBeTruthy()
  })

  it('renders nothing when closed at mount', () => {
    render(<BottomSheet open={false} onClose={() => {}} title="Output"><span>body</span></BottomSheet>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the close button and a mask tap both call onClose', () => {
    const { onClose } = renderSheet()
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // The mask is the first child of the presentation root that wraps the
    // dialog; the sheet also carries a `presentation` handle, so the root is
    // reached through the dialog's parent instead of the role query.
    fireEvent.click(rootOf().firstElementChild as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('Escape calls onClose', () => {
    const { onClose } = renderSheet()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the sheet mounted through the slide-down, then unmounts', () => {
    vi.useFakeTimers()
    try {
      const view = render(<BottomSheet open onClose={() => {}} title="Output"><span>body</span></BottomSheet>)
      expect(screen.getByRole('dialog', { name: 'Output' })).toBeTruthy()
      view.rerender(<BottomSheet open={false} onClose={() => {}} title="Output"><span>body</span></BottomSheet>)
      // Closing: still in the DOM, marked with the animated-close class.
      expect(screen.getByRole('dialog', { name: 'Output' })).toBeTruthy()
      expect(rootOf().className).toMatch(/closing/)
      act(() => { vi.advanceTimersByTime(240) })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('locks the page scroll while open and restores it after the close animation', () => {
    vi.useFakeTimers()
    try {
      const { view } = renderSheet()
      expect(document.body.style.overflow).toBe('hidden')
      view.rerender(<BottomSheet open={false} onClose={() => {}} title="Output"><span>body</span></BottomSheet>)
      // The sheet is still animating out, so the lock holds.
      expect(document.body.style.overflow).toBe('hidden')
      act(() => { vi.advanceTimersByTime(240) })
      expect(document.body.style.overflow).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-renders children when the owner does, so live content stays current', () => {
    const view = render(<BottomSheet open onClose={() => {}} title="Output"><span>v1</span></BottomSheet>)
    expect(screen.getByText('v1')).toBeTruthy()
    view.rerender(<BottomSheet open onClose={() => {}} title="Output"><span>v2</span></BottomSheet>)
    expect(screen.getByText('v2')).toBeTruthy()
  })

  it('opens at the rest height', () => {
    renderSheet()
    const sheet = screen.getByRole('dialog')
    expect(sheet.style.getPropertyValue('--sheet-h')).toBe('50dvh')
  })

  it('moves focus into the sheet when it opens', () => {
    renderSheet()
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('a drag down past the dismiss threshold closes the sheet', () => {
    const { onClose } = renderSheet()
    const handle = document.querySelector('[data-sheet-handle]') as HTMLElement
    fireEvent.pointerDown(handle, { clientY: 400 })
    fireEvent.pointerMove(handle, { clientY: 410 })
    fireEvent.pointerUp(handle, { clientY: 410 })
    expect(onClose).toHaveBeenCalled()
  })
})
