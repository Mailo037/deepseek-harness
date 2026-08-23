// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  ComparisonRail, LabeledField, SurfaceCard,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('compact composition primitives', () => {
  it('SurfaceCard groups a title, optional status, and content', () => {
    render(<SurfaceCard title="Updates" status={<span>Busy</span>}><button>Check</button></SurfaceCard>)
    const card = screen.getByRole('region', { name: 'Updates' })
    expect(card.textContent).toContain('Busy')
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy()
  })

  it('LabeledField associates custom controls and supports read-only values', () => {
    render(<>
      <LabeledField label="Source" labelFor="source"><button id="source">Unofficial</button></LabeledField>
      <LabeledField label="Target"><code>/repo</code></LabeledField>
    </>)
    expect(screen.getByLabelText('Source')).toBeTruthy()
    expect(screen.getByText('Target')).toBeTruthy()
    expect(screen.getByText('/repo')).toBeTruthy()
  })

  it('ComparisonRail stays decorative while rendering both endpoints', () => {
    const { container } = render(<ComparisonRail from="Local" to="Upstream" />)
    expect(screen.getByText('Local')).toBeTruthy()
    expect(screen.getByText('Upstream')).toBeTruthy()
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})
