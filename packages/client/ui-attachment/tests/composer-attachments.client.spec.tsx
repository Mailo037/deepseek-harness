// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type {
  ComposerAttachment, ComposerAttachmentsOwnerProps, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ComposerAttachments } from '../src/client/ComposerAttachments.tsx'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: string, params?: Readonly<Record<string, unknown>>): string => {
  const messages: Record<string, string> = {
    'image.pending': '待发送图片',
    'image.original': '原图',
    'image.preview': '原图预览',
    'image.closePreview': '关闭原图预览',
    'image.openOriginal': '查看原图',
    'image.scrollLeft': '向左滚动图片',
    'image.scrollRight': '向右滚动图片',
    'image.dropBlocked': '当前无法添加图片',
    'image.dropTitle': '图片拖动到此处即可添加',
  }
  if (key === 'image.tooManyPixels') return '图片分辨率过大，请压缩后重试'
  if (key === 'image.dimensionTooLarge') {
    const size = params?.size
    return `图片宽高不能超过 ${typeof size === 'string' ? size : ''}px，请缩小后重试`
  }
  if (key === 'image.remove') {
    const name = params?.name
    return `移除图片 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.remove') {
    const name = params?.name
    return `移除文件 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'file.restore') {
    const name = params?.name
    return `恢复 ${typeof name === 'string' ? name : ''}`
  }
  if (key === 'image.dropDesc') {
    const count = params?.count
    const size = params?.size
    return `最多 ${typeof count === 'number' ? String(count) : ''} 张，每张 ${typeof size === 'string' ? size : ''}`
  }
  return messages[key] ?? key
}) as ComposerAttachmentsProps['t']

function imageAttachment(id: string, name = `${id}.png`): Extract<ComposerAttachment, { kind: 'image' }> {
  return {
    kind: 'image',
    id: id as ComposerAttachment['id'],
    file: new File([Uint8Array.of(1)], name, { type: 'image/png' }),
    previewUrl: `blob:${id}`,
  }
}

function textAttachment(id: string, overrides: Partial<{ name: string; size: number; restorable: boolean }> = {}): ComposerAttachment {
  return {
    kind: 'text',
    id: id as ComposerAttachment['id'],
    name: overrides.name ?? `${id}.txt`,
    size: overrides.size ?? 12544,
    content: 'some content',
    ...(overrides.restorable === undefined ? {} : { restorable: overrides.restorable }),
  }
}

function workspaceFileAttachment(id: string, overrides: Partial<{ name: string; size: number }> = {}): ComposerAttachment {
  return {
    kind: 'workspace-file',
    id: id as ComposerAttachment['id'],
    name: overrides.name ?? `${id}.js`,
    size: overrides.size ?? 2550,
    path: `/project/${id}`,
  }
}

function props(overrides: Partial<ComposerAttachmentsOwnerProps> = {}): ComposerAttachmentsProps {
  return {
    attachments: [],
    canAcceptDrop: true,
    onAddFiles: () => {},
    onRemoveAttachment: () => {},
    onRestoreText: () => {},
    t,
    ...overrides,
  } as unknown as ComposerAttachmentsProps
}

describe('ComposerAttachments', () => {
  it('accepts file drops anywhere on the document and keeps non-file drags native', () => {
    const onAddFiles = vi.fn()
    const view = render(<ComposerAttachments {...props({
      onAddFiles,
      dropLimits: { count: 20, size: '5MB' },
    })} />)

    expect(fireEvent.dragEnter(document.body, { dataTransfer: null })).toBe(true)
    const textTransfer = { types: ['text/plain'], files: [], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.dragOver(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: textTransfer })).toBe(true)
    expect(view.queryByRole('status')).toBeNull()

    const file = imageAttachment('dropped').file
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' }
    expect(fireEvent.dragEnter(document.body, { dataTransfer })).toBe(false)
    expect(view.getByRole('status').textContent).toContain('图片拖动到此处即可添加')
    expect(view.getByRole('status').textContent).toContain('最多 20 张，每张 5MB')
    expect(fireEvent.dragOver(document.body, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(document.body, { dataTransfer })).toBe(false)
    expect(onAddFiles).toHaveBeenCalledWith([file])
    expect(view.queryByRole('status')).toBeNull()
  })

  it('tracks nested file drags and clears an aborted drag', () => {
    const view = render(<ComposerAttachments {...props()} />)
    const dataTransfer = { types: ['Files'], files: [], dropEffect: 'none' }
    fireEvent.dragLeave(document.body, {
      dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' },
    })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.getByRole('status')).toBeTruthy()
    fireEvent.dragLeave(document.body, { dataTransfer, clientX: 5, clientY: 5 })
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.documentElement, { dataTransfer })
    const leftViewport = new Event('dragleave', { bubbles: true, cancelable: true })
    Object.defineProperties(leftViewport, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: -1 },
      clientY: { value: 5 },
    })
    fireEvent(document.documentElement, leftViewport)
    expect(view.queryByRole('status')).toBeNull()
    fireEvent.dragEnter(document.body, { dataTransfer })
    fireEvent.dragEnd(window, { dataTransfer })
    expect(view.queryByRole('status')).toBeNull()
  })

  it('shows a blocked drop without forwarding its files', () => {
    const onAddFiles = vi.fn()
    const view = render(<ComposerAttachments {...props({ canAcceptDrop: false, onAddFiles })} />)
    const file = imageAttachment('blocked').file
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'copy' }
    fireEvent.dragEnter(document.body, { dataTransfer })
    expect(view.getByRole('status').textContent).toBe('当前无法添加图片')
    fireEvent.dragOver(document.body, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe('none')
    fireEvent.drop(document.body, { dataTransfer })
    expect(onAddFiles).not.toHaveBeenCalled()
    expect(view.queryByRole('status')).toBeNull()
  })

  it('routes rail removal and closes previews on Escape or attachment removal', () => {
    const onRemoveAttachment = vi.fn()
    const image = imageAttachment('draft-1', 'pixel.png')
    const initial = props({ attachments: [image], onRemoveAttachment })
    const view = render(<ComposerAttachments {...initial} />)

    fireEvent.click(view.getByRole('button', { name: '移除图片 pixel.png' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith(image.id)
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
    view.rerender(<ComposerAttachments {...props({ attachments: [], onRemoveAttachment })} />)
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()

    view.rerender(<ComposerAttachments {...initial} />)
    fireEvent.click(view.getByTitle('查看原图'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: '原图预览' })).toBeNull()
  })

  it('labels an unnamed attachment and its original-image preview', () => {
    const image = imageAttachment('unnamed', '')
    const view = render(<ComposerAttachments {...props({ attachments: [image] })} />)
    expect(view.getByAltText('待发送图片')).toBeTruthy()
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByAltText('原图')).toBeTruthy()
  })

  it('reactively shows and removes warning badge on attachments when active model changes', () => {
    let snapshot = {
      current: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      groups: [
        {
          provider: 'deepseek',
          models: [
            { id: 'deepseek-v4-flash', inputModalities: ['text'] },
            { id: 'deepseek-v4-flash-vision-exp', inputModalities: ['text', 'image'] },
          ],
        },
      ],
    }
    const listeners = new Set<() => void>()
    const fakeDirectory = {
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
      getSnapshot: () => snapshot,
    }

    const image = imageAttachment('draft-1', 'photo.png')
    const view = render(
      <ComposerAttachments
        {...props({ attachments: [image] })}
        directory={fakeDirectory}
      />,
    )

    // With deepseek-v4-flash (text-only), the warning badge is shown immediately
    expect(view.getByLabelText('image.modelUnsupported')).toBeDefined()

    // Switch model to vision-capable model
    snapshot = {
      ...snapshot,
      current: { provider: 'deepseek', model: 'deepseek-v4-flash-vision-exp' },
    }
    listeners.forEach(fn => fn())
    view.rerender(
      <ComposerAttachments
        {...props({ attachments: [image] })}
        directory={fakeDirectory}
      />,
    )

    // Warning badge disappears immediately
    expect(view.queryByLabelText('image.modelUnsupported')).toBeNull()

    // Switch back to text-only model
    snapshot = {
      ...snapshot,
      current: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    }
    listeners.forEach(fn => fn())
    view.rerender(
      <ComposerAttachments
        {...props({ attachments: [image] })}
        directory={fakeDirectory}
      />,
    )

    // Warning badge reappears immediately
    expect(view.getByLabelText('image.modelUnsupported')).toBeDefined()
  })

  it('renders a text attachment with restorable as a chip with restore button', () => {
    const onRestoreText = vi.fn()
    const onRemoveAttachment = vi.fn()
    const text = textAttachment('doc', { name: 'notes.txt', size: 12544, restorable: true })
    const view = render(
      <ComposerAttachments
        {...props({
          attachments: [text],
          onRestoreText,
          onRemoveAttachment,
        })}
      />,
    )

    // Renders as a chip — no thumbnail, no img element
    expect(view.queryByRole('img')).toBeNull()
    // File name and size are visible
    expect(view.getByText('notes.txt')).toBeTruthy()
    // 12544 bytes = 12.3 KB
    expect(view.getByText('12.3 KB')).toBeTruthy()
    // Remove button calls onRemoveAttachment
    fireEvent.click(view.getByRole('button', { name: '移除文件 notes.txt' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith(text.id)
    // Restore button calls onRestoreText
    fireEvent.click(view.getByRole('button', { name: '恢复 notes.txt' }))
    expect(onRestoreText).toHaveBeenCalledWith(text.id)
  })

  it('renders a workspace-file attachment as a chip without restore button', () => {
    const onRemoveAttachment = vi.fn()
    const wsFile = workspaceFileAttachment('code', { name: 'main.js', size: 2550 })
    const view = render(
      <ComposerAttachments
        {...props({
          attachments: [wsFile],
          onRemoveAttachment,
        })}
      />,
    )

    // Renders as a chip — no img element
    expect(view.queryByRole('img')).toBeNull()
    // File name and size are visible
    expect(view.getByText('main.js')).toBeTruthy()
    // 2550 bytes = 2.5 KB
    expect(view.getByText('2.5 KB')).toBeTruthy()
    // No restore button
    expect(view.queryByRole('button', { name: /恢复/ })).toBeNull()
    // Remove calls onRemoveAttachment
    fireEvent.click(view.getByRole('button', { name: '移除文件 main.js' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith(wsFile.id)
  })

  it('image thumbnails still open the lightbox', () => {
    const image = imageAttachment('draft-2', 'screenshot.png')
    const view = render(
      <ComposerAttachments
        {...props({ attachments: [image] })}
      />,
    )

    // Image thumbnail is present
    expect(view.getByAltText('screenshot.png')).toBeTruthy()
    // Clicking the thumbnail opens the lightbox
    fireEvent.click(view.getByTitle('查看原图'))
    expect(view.getByRole('dialog', { name: '原图预览' })).toBeTruthy()
  })

  it('warns images that exceed the projected pixel or dimension bounds', async () => {
    // jsdom decodes no images: a stubbed Image reports per-URL sizes.
    const sizes: Record<string, [number, number]> = {
      'blob:over-pixels': [2000, 1500],
      'blob:over-dimension': [3000, 100],
      'blob:fits': [800, 600],
    }
    function createImageStub(sizeMap: Record<string, [number, number]>) {
      return class {
        onload: (() => void) | null = null
        naturalWidth = 0
        naturalHeight = 0
        set src(value: string) {
          const [width, height] = sizeMap[value] ?? [10, 10]
          this.naturalWidth = width
          this.naturalHeight = height
          queueMicrotask(() => { this.onload?.() })
        }
      }
    }

    vi.stubGlobal('Image', createImageStub(sizes))
    const view = render(
      <ComposerAttachments
        {...props({
          attachments: [
            imageAttachment('over-pixels'),
            imageAttachment('over-dimension'),
            imageAttachment('fits'),
          ],
          imagePixelLimits: { maxPixels: 2_000_000, maxDimension: 2048 },
        })}
      />,
    )

    // 2000×1500 = 3M pixels over the 2M pixel budget; 3000px width over 2048.
    await waitFor(() => {
      expect(view.getByLabelText('图片分辨率过大，请压缩后重试')).toBeTruthy()
    })
    expect(view.getByLabelText('图片宽高不能超过 2048px，请缩小后重试')).toBeTruthy()
    // The passing image carries no warning badge of its own.
    expect(view.queryByLabelText('移除图片 fits.png')).toBeTruthy()
    expect(view.getAllByLabelText(/图片分辨率过大|图片宽高不能超过/)).toHaveLength(2)
  })

  it('drops the size warning when its image leaves the draft', async () => {
    const sizes: Record<string, [number, number]> = { 'blob:big': [4000, 4000] }
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      naturalWidth = 0
      naturalHeight = 0
      set src(value: string) {
        const [w, h] = sizes[value] ?? [10, 10]
        this.naturalWidth = w
        this.naturalHeight = h
        queueMicrotask(() => { this.onload?.() })
      }
    })
    const big = imageAttachment('big')
    const view = render(
      <ComposerAttachments
        {...props({
          attachments: [big],
          imagePixelLimits: { maxPixels: 2_000_000, maxDimension: 2048 },
        })}
      />,
    )
    await waitFor(() => {
      expect(view.getByLabelText('图片分辨率过大，请压缩后重试')).toBeTruthy()
    })
    view.rerender(
      <ComposerAttachments
        {...props({
          attachments: [],
          imagePixelLimits: { maxPixels: 2_000_000, maxDimension: 2048 },
        })}
      />,
    )
    expect(view.queryByLabelText('图片分辨率过大，请压缩后重试')).toBeNull()
  })
})
