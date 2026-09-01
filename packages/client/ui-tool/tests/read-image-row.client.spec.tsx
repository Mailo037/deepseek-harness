// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ReadImageRow } from '../src/client/tool/toolviews/read-image-row.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const attachment = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 68,
  width: 640,
  height: 320,
  name: 'result.png',
}

function result(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 10, time: 2_000, callId: 'image-call',
    call: { name: 'read_image', argsRaw: '{"file_path":"assets/result.png"}' },
    callTime: 1_000,
    content: [
      { type: 'text', text: '<path>assets/result.png</path>\n<type>image</type>\n<content>\nimage/png image, 640x320 px, 68 bytes\n</content>' },
      { type: 'image', attachment },
    ],
    isError: false, callView: null, resultView: null, subCalls: [], ...over,
  }
}

function props(block: ToolResultNode, renderMessageImages = vi.fn(() => <div data-image-preview />)) {
  return {
    callId: 'image-call', toolName: 'read_image', block, cwd: '/workspace', home: '/home/user',
    openFile: vi.fn(), inspect: vi.fn(), renderMessageImages, t,
  } as unknown as Parameters<typeof ReadImageRow>[0]
}

describe('ReadImageRow', () => {
  it('keeps the inspected image primary and moves its raw envelope behind Info', () => {
    const renderMessageImages = vi.fn(() => <div data-image-preview />)
    const view = render(<ReadImageRow {...props(result(), renderMessageImages)} />)
    expect(view.container.querySelector('[data-image-preview]')).not.toBeNull()
    expect(renderMessageImages).toHaveBeenCalledWith({
      images: [{ attachment }], align: 'start', variant: 'tile',
    })
    expect(view.queryByTestId('read-image-info')).toBeNull()
    expect(view.container.querySelector('[data-read-image-info]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '信息' }))
    expect(view.getByText(/image\/png image, 640x320 px, 68 bytes/)).toBeTruthy()
    expect(view.getByRole('button', { name: '隐藏信息' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('falls back to the normal read row until the result contains a durable image', () => {
    const block = result({ content: [{ type: 'text', text: 'image failed' }], isError: true })
    const view = render(<ReadImageRow {...props(block)} />)
    expect(view.container.querySelector('[data-read-image]')).toBeNull()
    expect(view.getByText('查看图片')).toBeTruthy()
    expect(view.getByText('image failed')).toBeTruthy()
  })
})
