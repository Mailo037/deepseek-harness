// @vitest-environment jsdom
/**
 * The fs-deny section's editing rules: the saved patterns load once, saving
 * writes the parsed line list, a failed save reports, and discard restores.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FsDenySection } from '../src/client/FsDenySection.tsx'
import type { FsDenySectionProps } from '../src/client/FsDenySection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

interface ScopeSpy {
  set: ReturnType<typeof vi.fn>
  getSnapshot: () => { value?: { patterns: readonly string[] } | undefined }
}

function scope(patterns: readonly string[] | undefined, set: ScopeSpy['set'] = vi.fn(() => Promise.resolve())): ScopeSpy {
  return {
    set,
    getSnapshot: () => ({ value: patterns === undefined ? undefined : { patterns } }),
  }
}

function renderSection(s: ScopeSpy): ScopeSpy {
  const props = { t: (key: keyof typeof en) => en[key], settingsScope: s } as unknown as FsDenySectionProps
  render(<FsDenySection {...props} />)
  return s
}

function saveButton(): HTMLButtonElement {
  const node = screen.getByText(en.fsDenySave).closest('button')
  if (node === null) throw new Error('no save button')
  return node
}

describe('the fs-deny section', () => {
  it('loads the saved patterns and enables saving only on change', async () => {
    renderSection(scope(['**/.env', '**/.ssh/**']))
    const box = screen.getByRole('textbox')
    await waitFor(() => { expect((box as HTMLTextAreaElement).value).toBe('**/.env\n**/.ssh/**') })
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(box, { target: { value: '**/.env\n' } })
    expect(saveButton().disabled).toBe(false)
    expect(screen.getByText(en.fsDenyDiscard)).toBeTruthy()
  })

  it('starts empty when the scope has no value', async () => {
    renderSection(scope(undefined))
    const box = screen.getByRole('textbox')
    await waitFor(() => { expect((box as HTMLTextAreaElement).value).toBe('') })
    expect(saveButton().disabled).toBe(true)
  })

  it('saves the trimmed non-empty lines and returns to idle', async () => {
    vi.useFakeTimers()
    const s = renderSection(scope(['**/.env']))
    await act(async () => {})
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  **/.env  \n\n**/.ssh/**\n' } })
    fireEvent.click(saveButton())
    await act(async () => {})
    expect(s.set).toHaveBeenCalledWith('patterns', ['**/.env', '**/.ssh/**'])
    expect(screen.getByText(en.fsDenySaved)).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(screen.queryByText(en.fsDenySaved)).toBeNull()
    vi.useRealTimers()
  })

  it('reports a failed save', async () => {
    vi.useFakeTimers()
    renderSection(scope(['**/.env'], vi.fn(() => Promise.reject(new Error('down')))))
    await act(async () => {})
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(saveButton())
    await act(async () => {})
    expect(screen.getByText(en.fsDenyError)).toBeTruthy()
    vi.useRealTimers()
  })

  it('discards edits back to the saved patterns', async () => {
    renderSection(scope(['**/.env']))
    const box = screen.getByRole('textbox')
    await waitFor(() => { expect((box as HTMLTextAreaElement).value).toBe('**/.env') })
    fireEvent.change(box, { target: { value: 'junk' } })
    fireEvent.click(screen.getByText(en.fsDenyDiscard))
    expect((box as HTMLTextAreaElement).value).toBe('**/.env')
    expect(screen.queryByText(en.fsDenyDiscard)).toBeNull()
  })

  it('renders a remote notice when isLoopback is false', () => {
    const s = scope(['**/.env'])
    const props = { t: (key: keyof typeof en) => en[key], settingsScope: s, isLoopback: false } as unknown as FsDenySectionProps
    render(<FsDenySection {...props} />)
    expect(screen.getByText(en.configureInWebGuiTitle)).toBeTruthy()
    expect(screen.getByText(en.fsDenyRemoteDescription)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
