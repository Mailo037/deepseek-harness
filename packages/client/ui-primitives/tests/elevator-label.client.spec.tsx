// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElevatorLabel } from '../src/ElevatorLabel.tsx'

afterEach(cleanup)

describe('ElevatorLabel', () => {
  it('keeps its initial value still, then exchanges a changed value vertically', () => {
    const view = render(<ElevatorLabel value="First workspace" />)
    const track = view.container.firstElementChild as HTMLElement
    const values = () => [...track.querySelectorAll('[data-elevator-value]')] as HTMLElement[]
    expect(values().map(value => value.textContent)).toEqual(['First workspace'])

    view.rerender(<ElevatorLabel value="Second workspace" />)
    expect(values().map(value => value.textContent)).toEqual(['First workspace', 'Second workspace'])
    expect(values()[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(values()[1]?.className).toMatch(/incoming/)
  })

  it('replaces the value immediately when reduced motion is preferred', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('matchMedia', matchMedia)
    try {
      const view = render(<ElevatorLabel value="First workspace" />)
      const track = view.container.firstElementChild as HTMLElement
      view.rerender(<ElevatorLabel value="Second workspace" />)
      expect([...track.querySelectorAll('[data-elevator-value]')].map(value => value.textContent)).toEqual(['Second workspace'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('gives each rapid replacement a fresh incoming label', () => {
    const view = render(<ElevatorLabel value="First workspace" />)
    const track = view.container.firstElementChild as HTMLElement
    view.rerender(<ElevatorLabel value="Second workspace" />)
    const second = track.querySelectorAll('[data-elevator-value]')[1]
    view.rerender(<ElevatorLabel value="Third workspace" />)
    const values = track.querySelectorAll('[data-elevator-value]')
    expect([...values].map(value => value.textContent)).toEqual(['Second workspace', 'Third workspace'])
    expect(values[1]).not.toBe(second)
    expect(values[1]?.className).toMatch(/incoming/)
  })
})
