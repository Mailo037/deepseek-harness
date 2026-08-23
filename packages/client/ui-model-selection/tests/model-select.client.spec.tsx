// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect, placeMenu, placeMenuPhoneTop } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('filters models and providers by search query', () => {
    const groups = [
      {
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputModalities: ['text'] },
          { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek-V4-Flash-Vision (Exp)', inputModalities: ['text', 'image'] },
        ],
      },
      {
        id: 'openrouter',
        name: 'OpenRouter',
        models: [
          { id: 'qwen-vl', name: 'Qwen VL', inputModalities: ['text', 'image', 'video'] },
        ],
      },
    ]
    const directory = createSnapshotStore(state({ groups }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    // Initially both groups are present
    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(2)
    expect(screen.getAllByTitle('Qwen VL').length).toBe(1)

    // Search by modality 'video'
    const searchInput = screen.getByPlaceholderText('搜索模型或提供商…')
    fireEvent.change(searchInput, { target: { value: 'video' } })

    expect(screen.getAllByTitle('Qwen VL').length).toBe(1)
    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(1) // only trigger
    expect(screen.queryByTitle('DeepSeek-V4-Flash-Vision (Exp)')).toBeNull()

    // Search by modality 'image'
    fireEvent.change(searchInput, { target: { value: 'image' } })
    expect(screen.getAllByTitle('DeepSeek-V4-Flash-Vision (Exp)').length).toBe(1)
    expect(screen.getAllByTitle('Qwen VL').length).toBe(1)
    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(1) // only trigger

    // Search by German alias 'bild'
    fireEvent.change(searchInput, { target: { value: 'bild' } })
    expect(screen.getAllByTitle('DeepSeek-V4-Flash-Vision (Exp)').length).toBe(1)
    expect(screen.getAllByTitle('Qwen VL').length).toBe(1)

    // Clear search query
    fireEvent.change(searchInput, { target: { value: 'non-existent-xyz' } })
    expect(screen.getByText('未找到匹配的模型。')).toBeTruthy()
  })

  it('collapses and expands provider groups on click', () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      ],
    }]
    const directory = createSnapshotStore(state({ groups }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(2)

    // Click header to collapse
    const groupHeader = screen.getByTitle('DeepSeek')
    fireEvent.click(groupHeader)

    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(1) // only trigger

    // Click header again to expand
    fireEvent.click(groupHeader)
    expect(screen.getAllByTitle('DeepSeek-V4-Flash').length).toBe(2)
  })
})

const positionedElement = (l: number, t: number, r: number, b: number) => ({
  getBoundingClientRect: () => ({
    left: l, top: t, right: r, bottom: b, x: l, y: t,
    width: r - l, height: b - t, toJSON: () => ({}),
  }) as DOMRect,
})

describe('placeMenu viewport clamping', () => {
  const rect = positionedElement
  const menu = (w: number, h: number) => ({ offsetWidth: w, offsetHeight: h })
  const MARGIN = 8

  it('keeps the preferred right-aligned-above placement when it fits', () => {
    const pos = placeMenu(rect(0, 0, 0, 0), rect(300, 600, 600, 628), menu(320, 200))
    expect(pos.left).toBe(600 - 320)
    expect(pos.top).toBe(600 - 200 - 8)
  })

  it('clamps the left edge when the trigger is near the left of a narrow viewport', () => {
    const pos = placeMenu(rect(0, 0, 0, 0), rect(8, 600, 60, 628), menu(320, 200))
    expect(pos.left).toBe(MARGIN)
  })

  it('clamps the right edge when the trigger is near the right edge', () => {
    // trigger right edge beyond viewport right bound
    const pos = placeMenu(rect(0, 0, 0, 0), rect(900, 600, 1030, 628), menu(320, 200))
    expect(pos.left).toBe(1024 - 320 - MARGIN)
  })

  it('flips below when there is no room above', () => {
    const pos = placeMenu(rect(0, 0, 0, 0), rect(100, 40, 200, 68), menu(320, 200))
    expect(pos.top).toBe(68 + 8)
  })

  it('clamps to the top margin when neither side fits vertically', () => {
    const pos = placeMenu(rect(0, 0, 0, 0), rect(100, 200, 200, 228), menu(320, 700))
    expect(pos.top).toBe(MARGIN)
  })

  it('accounts for the root offset when the root is not at the viewport origin', () => {
    const pos = placeMenu(rect(16, 16, 16, 16), rect(200, 500, 300, 528), menu(320, 200))
    // viewport-coordinate x = 300 - 320 = -20 → clamped to 8 → root-relative = 8 - 16 = -8
    expect(pos.left).toBe(8 - 16)
    // viewport y = 500 - 200 - 8 = 292 → no clamp → root-relative = 292 - 16
    expect(pos.top).toBe(292 - 16)
  })
})

describe('placeMenuPhoneTop upward-only placement', () => {
  const rect = positionedElement
  const MARGIN = 8

  it('opens above a trigger near the viewport bottom without flipping below', () => {
    vi.stubGlobal('innerHeight', 700)
    try {
      const pos = placeMenuPhoneTop(rect(0, 0, 0, 0), rect(300, 640, 420, 668), { offsetHeight: 380 })
      expect(pos.top).toBe(640 - 380 - 8)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clamps to the top margin when even the full viewport cannot hold the card', () => {
    vi.stubGlobal('innerHeight', 700)
    try {
      const pos = placeMenuPhoneTop(rect(0, 0, 0, 0), rect(300, 640, 420, 668), { offsetHeight: 900 })
      // Height caps at vh - 2×margin (684); y clamps to the top margin.
      expect(pos.top).toBe(MARGIN)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns a root-relative top when the composer is offset from the viewport', () => {
    vi.stubGlobal('innerHeight', 700)
    try {
      const pos = placeMenuPhoneTop(rect(0, 520, 0, 520), rect(300, 640, 420, 668), { offsetHeight: 100 })
      // Viewport y = 640 - 100 - 8 = 532; `.menu` is absolute under root.
      expect(pos.top).toBe(532 - 520)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('open-menu re-placement', () => {
  /** Minimal ResizeObserver stand-in recording what the component observes. */
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    readonly observed: Element[] = []
    constructor(readonly callback: ResizeObserverCallback) {
      FakeResizeObserver.instances.push(this)
    }
    observe(target: Element): void { this.observed.push(target) }
    disconnect(): void {}
    unobserve(): void {}
  }

  const rect = (l: number, t: number, r: number, b: number) => ({
    left: l, top: t, right: r, bottom: b, x: l, y: t, width: r - l, height: b - t, toJSON: () => ({}),
  })

  it('re-places the card when the open menu grows after the initial placement', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    FakeResizeObserver.instances = []
    try {
      const directory = createSnapshotStore(state())
      render(<ModelSelect
        locked={false}
        available
        directory={directory}
        load={vi.fn()}
        select={vi.fn().mockResolvedValue(true)}
        t={t}
      />)

      // The trigger sits near the viewport bottom: the card opens upward.
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      trigger.getBoundingClientRect =
        () => rect(300, 600, 420, 628)

      fireEvent.click(trigger)
      const menu = screen.getByRole('menu')
      // Placement measured a zero-height layout (jsdom): y = 600 − 0 − 8.
      expect(menu.style.top).toBe('592px')
      const observer = FakeResizeObserver.instances.at(-1)
      expect(observer?.observed).toContain(menu)

      // Drilling into a pane grows the card after the initial placement; the
      // size change must re-place it instead of extending past the fold.
      Object.defineProperty(menu, 'offsetHeight', { value: 200, configurable: true })
      act(() => {
        observer!.callback([], observer as unknown as ResizeObserver)
      })
      // Preferred above-placement recomputed for the grown card:
      // y = 600 − 200 − 8 = 392 (no clamp).
      expect(menu.style.top).toBe('392px')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps root and effort panes root-relative above the mobile composer through resize', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('innerHeight', 700)
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    FakeResizeObserver.instances = []
    try {
      render(<ModelSelect
        locked={false}
        available
        directory={createSnapshotStore(state())}
        load={vi.fn()}
        select={vi.fn().mockResolvedValue(true)}
        t={t}
      />)

      const trigger = screen.getByRole('button', { name: /选择模型/ })
      const root = trigger.parentElement!
      root.getBoundingClientRect = () => rect(0, 520, 420, 700)
      trigger.getBoundingClientRect = () => rect(300, 640, 420, 668)
      fireEvent.click(trigger)
      const menu = screen.getByRole('menu')
      Object.defineProperty(menu, 'offsetHeight', { value: 100, configurable: true })
      const observer = FakeResizeObserver.instances.at(-1)!
      act(() => { observer.callback([], observer) })
      // Viewport y = 640 - 100 - 8 = 532, then root-relative 12px.
      expect(menu.style.top).toBe('12px')

      fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
      Object.defineProperty(menu, 'offsetHeight', { value: 160, configurable: true })
      act(() => { observer.callback([], observer) })
      // Effort pane remeasures independently, still in the root's frame.
      expect(menu.style.top).toBe('-48px')

      vi.stubGlobal('innerHeight', 620)
      act(() => { window.dispatchEvent(new Event('resize')) })
      // The viewport clamp moves the effort pane up, not below the trigger.
      expect(menu.style.top).toBe('-68px')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
