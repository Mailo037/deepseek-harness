// @vitest-environment jsdom
// AttachmentRail behavior in the jsdom lane: item rendering and callbacks,
// arrow paging over stubbed scroll geometry (jsdom lays nothing out), the
// exclusive vertical-wheel pan, and the new-item end reveal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentRail } from '../src/AttachmentRail.tsx'
import type { AttachmentRailItem, AttachmentRailLabels } from '../src/AttachmentRail.tsx'

afterEach(cleanup)

// jsdom implements no ResizeObserver; the stub records instances so a test
// can drive the size-change recompute path.
const observers: { callback: ResizeObserverCallback; observed: Element[] }[] = []
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('ResizeObserver', class {
    observed: Element[] = []
    constructor(callback: ResizeObserverCallback) {
      observers.push({ callback, observed: this.observed })
    }

    observe(el: Element) { this.observed.push(el) }
    disconnect() { this.observed.length = 0 }
  })
})
afterEach(() => { vi.unstubAllGlobals() })

const labels: AttachmentRailLabels = {
  group: '待发送图片',
  open: '查看原图',
  scrollLeft: '向左滚动图片',
  scrollRight: '向右滚动图片',
}

function item(id: string): AttachmentRailItem {
  return { id, previewUrl: `blob:${id}`, alt: `${id}.png`, removeLabel: `移除图片 ${id}.png` }
}

function fileItem(id: string, overrides: Partial<AttachmentRailItem> = {}): AttachmentRailItem {
  return {
    id,
    previewUrl: '',
    alt: `${id}.txt`,
    removeLabel: `移除文件 ${id}.txt`,
    file: { name: `${id}.txt`, sizeText: '12.3 KB' },
    ...overrides,
  }
}

/** Stub the rail's scroll geometry (jsdom reports 0 for every metric). */
function stubGeometry(rail: HTMLElement, { scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true })
  let scrollLeft = 0
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => { scrollLeft = value },
  })
  const scrollBy = vi.fn((options: { left: number }) => {
    scrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, scrollLeft + options.left))
  })
  rail.scrollBy = scrollBy as unknown as typeof rail.scrollBy
  return { scrollBy, setScrollLeft: (value: number) => { scrollLeft = value } }
}

describe('AttachmentRail', () => {
  it('renders thumbnails in order and routes open and remove clicks', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const items = [item('a'), item('b')]
    const view = render(<AttachmentRail items={items} labels={labels} onOpen={onOpen} onRemove={onRemove} onRestore={vi.fn()} />)
    const rail = view.getByRole('group', { name: '待发送图片' })
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['a.png', 'b.png'])
    fireEvent.click(view.getAllByTitle('查看原图')[0]!)
    expect(onOpen).toHaveBeenCalledWith(items[0])
    fireEvent.click(view.getByRole('button', { name: '移除图片 b.png' }))
    expect(onRemove).toHaveBeenCalledWith(items[1])
  })

  it('shows edge arrows from scroll geometry and pages a viewport at a time', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // No arrows until geometry is observed (mount saw jsdom's zero metrics).
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    fireEvent.scroll(rail)
    // Same-edges scroll takes the memoized-state path.
    fireEvent.scroll(rail)
    expect(view.queryByLabelText('向左滚动图片')).toBeNull()
    const right = view.getByLabelText('向右滚动图片')
    // clientWidth 200 - 64 < the 200 floor: pages by the floor.
    fireEvent.click(right)
    expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior: 'smooth' })
    fireEvent.scroll(rail)
    // Scrolled to the far edge: only the left arrow remains.
    expect(view.queryByLabelText('向右滚动图片')).toBeNull()
    fireEvent.click(view.getByLabelText('向左滚动图片'))
    expect(scrollBy).toHaveBeenCalledWith({ left: -200, behavior: 'smooth' })
    fireEvent.scroll(rail)
    expect(view.queryByLabelText('向左滚动图片')).toBeNull()
    expect(view.getByLabelText('向右滚动图片')).toBeTruthy()
  })

  it('shows both arrows mid-scroll and recomputes when the rail itself resizes', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { setScrollLeft } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    setScrollLeft(100)
    // The component observes the rail element, not the window: a sidebar or
    // panel resize reaches it through the ResizeObserver callback.
    expect(observers.at(-1)?.observed).toContain(rail)
    act(() => { observers.at(-1)!.callback([], undefined as never) })
    expect(view.getByLabelText('向左滚动图片')).toBeTruthy()
    expect(view.getByLabelText('向右滚动图片')).toBeTruthy()
  })

  it('keeps scrolling available when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const view = render(
      <AttachmentRail items={[item('a')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    expect(view.getByRole('group', { name: '待发送图片' })).toBeTruthy()
    view.unmount()
  })

  it('pans horizontally on a vertical wheel, consuming the event, with clamped normalized travel', () => {
    const view = render(
      <AttachmentRail items={[item('a'), item('b')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    // Converted ticks are consumed (preventDefault): fireEvent returns false.
    expect(fireEvent.wheel(rail, { deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 30, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: 500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: 60, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -500 })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // Firefox notch wheels report lines; a page-mode wheel reports viewports.
    fireEvent.wheel(rail, { deltaY: 2, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(scrollBy).toHaveBeenCalledWith({ left: 32, behavior: 'auto' })
    fireEvent.wheel(rail, { deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_PAGE })
    expect(scrollBy).toHaveBeenCalledWith({ left: -60, behavior: 'auto' })
    // A diagonal pan is consumed too — nothing vertical may escape the rail —
    // and keeps its horizontal intent.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 30 })).toBe(false)
    expect(scrollBy).toHaveBeenCalledWith({ left: 12, behavior: 'auto' })
    // A purely horizontal pan and a zero-delta wheel keep native behavior.
    expect(fireEvent.wheel(rail, { deltaX: 12, deltaY: 0 })).toBe(true)
    fireEvent.wheel(rail, { deltaY: 0 })
    expect(scrollBy).toHaveBeenCalledTimes(6)
  })

  it('pages instantly under a reduced-motion preference, smoothly otherwise', () => {
    for (const [matches, behavior] of [[true, 'auto'], [false, 'smooth']] as const) {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
      const view = render(
        <AttachmentRail items={[item('a'), item('b'), item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
      )
      const rail = view.getByRole('group', { name: '待发送图片' })
      const { scrollBy } = stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
      fireEvent.scroll(rail)
      fireEvent.click(view.getByLabelText('向右滚动图片'))
      expect(scrollBy).toHaveBeenCalledWith({ left: 200, behavior })
      view.unmount()
    }
  })

  it('reveals the rail end when an item is added, not when one is removed', () => {
    const first = [item('a'), item('b')]
    const view = render(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    const rail = view.getByRole('group', { name: '待发送图片' })
    stubGeometry(rail, { scrollWidth: 400, clientWidth: 200 })
    view.rerender(
      <AttachmentRail items={[...first, item('c')]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    expect(rail.scrollLeft).toBe(200)
    view.rerender(
      <AttachmentRail items={first} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    // Removal keeps the position; only growth jumps to the end.
    expect(rail.scrollLeft).toBe(200)
  })

  it('renders a warning badge with aria-label when warning is present on an item', () => {
    const warningItem: AttachmentRailItem = {
      ...item('warn-1'),
      warning: 'Model does not support images',
    }
    const view = render(
      <AttachmentRail items={[warningItem]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={vi.fn()} />,
    )
    const badge = view.getByLabelText('Model does not support images')
    expect(badge).toBeDefined()
  })

  it('renders a document chip for a file attachment instead of an image thumbnail', () => {
    const onOpen = vi.fn()
    const onRemove = vi.fn()
    const itemWithFile = fileItem('f', {
      file: { name: 'report.txt', sizeText: '12.3 KB' },
      removeLabel: '移除文件 report.txt',
    })
    const view = render(
      <AttachmentRail items={[itemWithFile]} labels={labels} onOpen={onOpen} onRemove={onRemove} onRestore={vi.fn()} />,
    )
    // No image thumbnail and no lightbox-open affordance.
    expect(view.queryByTitle('查看原图')).toBeNull()
    expect(view.queryByText('查看原图')).toBeNull()
    // The chip surfaces the file name and size as text.
    expect(view.getByText('report.txt')).toBeTruthy()
    expect(view.getByText('12.3 KB')).toBeTruthy()
    // Remove still routes through onRemove.
    fireEvent.click(view.getByRole('button', { name: '移除文件 report.txt' }))
    expect(onRemove).toHaveBeenCalledWith(itemWithFile)
  })

  it('renders no restore control without a restore label and calls onRestore when one is present', () => {
    const onRestore = vi.fn()
    const plain = fileItem('plain')
    const first = render(
      <AttachmentRail items={[plain]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={onRestore} />,
    )
    expect(first.queryByRole('button', { name: '恢复' })).toBeNull()
    first.unmount()

    const restorable = fileItem('restorable', { restoreLabel: '恢复 report.txt' })
    const view2 = render(
      <AttachmentRail items={[restorable]} labels={labels} onOpen={vi.fn()} onRemove={vi.fn()} onRestore={onRestore} />,
    )
    const restore = view2.getByRole('button', { name: '恢复 report.txt' })
    fireEvent.click(restore)
    expect(onRestore).toHaveBeenCalledWith(restorable)
  })
})
