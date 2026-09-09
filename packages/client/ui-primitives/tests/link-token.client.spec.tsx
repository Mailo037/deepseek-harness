// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from '../src/markdown/MarkdownText.tsx'
import { MessageText } from '../src/markdown/MessageText.tsx'
import { FileTypeIcon, fileTypeIconKind } from '../src/FileTypeIcon.tsx'

afterEach(cleanup)

describe('transcript link tokens', () => {
  it.each(['user', 'assistant'])('resolves a %s URL to its title while keeping the destination', async (role) => {
    const resolveLinkTitle = vi.fn(async () => 'Example &amp; documentation')
    const text = 'See https://example.com/docs.'
    const { container } = render(role === 'user'
      ? <MessageText text={text} linkTokens resolveLinkTitle={resolveLinkTitle} />
      : <MarkdownText text={text} linkFavicons resolveLinkTitle={resolveLinkTitle} />)
    const link = await screen.findByRole('link', { name: 'Example & documentation' })
    expect(link.getAttribute('href')).toBe('https://example.com/docs')
    expect(link.getAttribute('title')).toBe('https://example.com/docs')
    expect(container.textContent).toContain('documentation.')
    expect(resolveLinkTitle).toHaveBeenCalledWith('https://example.com/docs')
    const image = link.querySelector('img')!
    fireEvent.error(image)
    expect(link.querySelector('img')).toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('keeps authored text or the hostname when a title is unavailable', async () => {
    const resolveLinkTitle = vi.fn(async () => null)
    render(<MessageText text="[Useful guide](https://example.com/guide) https://example.org/" linkTokens resolveLinkTitle={resolveLinkTitle} />)
    expect(screen.getByRole('link', { name: 'Useful guide' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'example.org' })).toBeTruthy()
    await waitFor(() => { expect(resolveLinkTitle).toHaveBeenCalledTimes(2) })
  })

  it('uses file glyphs and basenames without requesting page titles', () => {
    const resolveLinkTitle = vi.fn()
    const { container } = render(<MarkdownText text="[Download](https://example.com/files/report.PDF?download=1) [Settings](https://example.com/config.yaml)" linkFavicons resolveLinkTitle={resolveLinkTitle} />)
    expect(screen.getByRole('link', { name: 'report.PDF' }).textContent).toContain('PDF')
    expect(screen.getByRole('link', { name: 'config.yaml' })).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
    expect(resolveLinkTitle).not.toHaveBeenCalled()
  })

  it('does not let a late title replace a newer link', async () => {
    let finish!: (title: string) => void
    const resolveLinkTitle = vi.fn((url: string) => url.includes('first')
      ? new Promise<string>((resolve) => { finish = resolve }) : Promise.resolve('Second'))
    const view = render(<MarkdownText text="https://first.example/" linkFavicons resolveLinkTitle={resolveLinkTitle} />)
    view.rerender(<MarkdownText text="https://second.example/" linkFavicons resolveLinkTitle={resolveLinkTitle} />)
    await screen.findByRole('link', { name: 'Second' })
    await act(async () => { finish('First') })
    expect(screen.queryByRole('link', { name: 'First' })).toBeNull()
  })

  it('keeps unsafe URLs and fenced code inert and accepts malformed percent escapes', () => {
    const { container } = render(<MarkdownText text={'[unsafe](javascript:alert)\n\n```txt\nhttps://example.com\n```\n\nhttps://example.com/%ZZ'} linkFavicons />)
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('pre a')).toBeNull()
  })
})

describe('file token glyphs', () => {
  it.each(['report.PDF', 'https://example.com/report.pdf?download=1', '@"dir/report.pdf"'])('identifies PDF %s', (path) => {
    expect(fileTypeIconKind(path)).toBe('pdf')
  })
  it.each(['settings.json', 'config.yaml', '.env', '.env.local', '.npmrc', 'app.ini', 'Dockerfile'])('identifies configuration %s', (path) => {
    expect(fileTypeIconKind(path)).toBe('config')
  })
  it('renders distinct PDF and configuration glyphs', () => {
    const view = render(<FileTypeIcon kind="pdf" />)
    expect(view.container.textContent).toBe('PDF')
    view.rerender(<FileTypeIcon kind="config" />)
    expect(view.container.textContent).toBe('')
    expect(view.container.querySelector('svg')).not.toBeNull()
  })
})
