// @vitest-environment jsdom
/** Model-row reorder and modality-override behavior across both adapter editors. */
import { useState } from 'react'
import { createEvent } from '@testing-library/dom'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekModelsEditor } from '../src/client/DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from '../src/client/DeepSeekModelsEditor.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import type { ModelDraft, ProbeTarget } from '../src/client/ModelListEditor.tsx'
import { ModelModalityDialog } from '../src/client/ModelModalityDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** A minimal DataTransfer; jsdom drag events cannot carry a real one. */
const transfer = (): DataTransfer => ({
  getData: () => '',
  setData: vi.fn(),
  effectAllowed: 'none',
  dropEffect: 'none',
}) as unknown as DataTransfer

/** Open one model row's advanced fold, where the modalities and capacities live. */
const expandRow = (position: number): void => {
  fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} ${position}`))
}

const grip = (position: number): HTMLButtonElement =>
  screen.getByLabelText(`${en.reorderModel} ${position}`) as HTMLButtonElement

const box = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement

const dropMarker = (half: 'before' | 'after'): Element | null =>
  document.querySelector(`[class*="modelEntryDrop${half === 'before' ? 'Before' : 'After'}"]`)

describe('ModelModalityDialog', () => {
  it('spells an unknown modality with its raw value and applies in choice order', () => {
    const onApply = vi.fn()
    render(<ModelModalityDialog
      choices={['text', 'ritual'] as const}
      selected={['text', 'ritual']}
      allowEmpty={false}
      t={t}
      onApply={onApply}
      onClose={vi.fn()}
    />)
    expect(box('ritual').checked).toBe(true)
    // Emptying the selection is refused for a schema that needs at least one.
    fireEvent.click(box(en.modalityText))
    fireEvent.click(box('ritual'))
    expect((screen.getByText(en.apply) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(box('ritual'))
    fireEvent.click(box(en.modalityText))
    fireEvent.click(screen.getByText(en.apply))
    expect(onApply).toHaveBeenCalledWith(['text', 'ritual'])
  })

  it('lets an empty selection through when inheriting is meaningful', () => {
    const onApply = vi.fn()
    render(<ModelModalityDialog
      choices={['text', 'image'] as const}
      selected={['text']}
      allowEmpty
      t={t}
      onApply={onApply}
      onClose={vi.fn()}
    />)
    expect(screen.getByText(en.modalityInheritHint)).toBeTruthy()
    fireEvent.click(box(en.modalityText))
    // No selection still applies for the inherit path.
    expect((screen.getByText(en.apply) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText(en.apply))
    expect(onApply).toHaveBeenCalledWith([])
  })

  it('closes without applying when the user cancels', () => {
    const onClose = vi.fn()
    const onApply = vi.fn()
    render(<ModelModalityDialog
      choices={['text'] as const}
      selected={['text']}
      allowEmpty={false}
      t={t}
      onApply={onApply}
      onClose={onClose}
    />)
    fireEvent.click(screen.getByText(en.cancel))
    expect(onClose).toHaveBeenCalled()
    expect(onApply).not.toHaveBeenCalled()
  })
})

describe('DeepSeekModelsEditor modalities and reorder', () => {
  const ROWS: DeepSeekModelDraft[] = [
    { id: 'deepseek-v4-flash', name: 'Flash' },
    { id: 'deepseek-v4-pro', contextWindow: 1_000_000 },
  ]

  /**
   * Stateful harness: the editor is controlled, so a test that applies or moves
   * rows must feed the new `models` back the way the provider card does, or the
   * DOM stays on the old props.
   */
  const mountDeepSeek = (models: readonly DeepSeekModelDraft[] = ROWS, disabled = false): { onChange: ReturnType<typeof vi.fn> } => {
    const onChange = vi.fn()
    const Harness = (): ReturnType<typeof DeepSeekModelsEditor> => {
      const [rows, setRows] = useState(models)
      return <DeepSeekModelsEditor
        models={rows}
        overridden
        defaultContextWindow={undefined}
        defaultMaxTokens={undefined}
        t={t}
        disabled={disabled}
        onChange={(next) => { setRows(next); onChange(next) }}
        onReset={vi.fn()}
      />
    }
    render(<Harness />)
    return { onChange }
  }

  it('edits a row\'s modalities behind a custom-override warning and tags the override', () => {
    const { onChange } = mountDeepSeek()
    expandRow(1)
    expect(screen.getByText(en.modelModalities)).toBeTruthy()
    expect(screen.getByText(en.modalityText)).toBeTruthy()
    expect(screen.queryByText(en.modalityCustomTag)).toBeNull()

    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    expect(screen.getByText(en.modalityWarning)).toBeTruthy()
    expect(box(en.modalityText).checked).toBe(true)
    expect(box(en.modalityImage).checked).toBe(false)

    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.apply))

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'deepseek-v4-flash', inputModalities: ['text', 'image'] }),
      ROWS[1],
    ])
    expect(screen.getByText(en.modalityCustomTag)).toBeTruthy()
    expect(screen.queryByText(en.modalityDialogTitle)).toBeNull()
  })

  it('requires one modality, applying the selection in canonical order', () => {
    const { onChange } = mountDeepSeek()
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    expect(screen.getByText(en.modalityRequiredHint)).toBeTruthy()
    // The schema floors the list at one entry; emptying it refuses to apply.
    fireEvent.click(box(en.modalityText))
    expect((screen.getByText(en.apply) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(box(en.modalityText))
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(box(en.modalityVideo))
    fireEvent.click(screen.getByText(en.apply))
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'deepseek-v4-flash', inputModalities: ['text', 'image', 'video'] }),
      ROWS[1],
    ])
  })

  it('closes the dialog without a write when the user cancels', () => {
    const { onChange } = mountDeepSeek()
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.cancel))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(en.modalityDialogTitle)).toBeNull()
  })

  it('reads a cleared override as the text default again', () => {
    mountDeepSeek([
      { id: 'deepseek-v4-flash' },
      { id: 'deepseek-v4-pro', inputModalities: [] },
      { id: 'other', inputModalities: ['hologram'] },
    ])
    expandRow(2)
    expandRow(3)
    // An override invalid per the schema falls back, and a value outside the
    // adapter's choices is filtered out rather than shown verbatim.
    expect(screen.getAllByText(en.modalityText).length).toBe(2)
    expect(screen.queryByText('hologram')).toBeNull()
  })

  it('keeps an open dialog anchored to its row when that row moves', () => {
    const { onChange } = mountDeepSeek()
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    fireEvent.keyDown(grip(1), { key: 'ArrowDown' })
    // The dialog stays open, now on the row the moved row became.
    expect(screen.getByText(en.modalityDialogTitle)).toBeTruthy()
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.apply))
    // row 2, now 'deepseek-v4-flash', carries the override.
    expect(onChange).toHaveBeenLastCalledWith([
      ROWS[1],
      { ...ROWS[0], inputModalities: ['text', 'image'] },
    ])
  })

  it('re-anchors an open dialog when the row before it is removed', () => {
    const { onChange } = mountDeepSeek()
    expandRow(2)
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 2`))
    // Removing the row before the one being edited shifts the dialog's target
    // down so it stays on the same model.
    fireEvent.click(screen.getByLabelText(`${en.removeModel} 1`))
    expect(screen.getByText(en.modalityDialogTitle)).toBeTruthy()
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.apply))
    // The remaining row (deepseek-v4-pro) carries the override.
    expect(onChange).toHaveBeenLastCalledWith([
      { ...ROWS[1], inputModalities: ['text', 'image'] },
    ])
  })

  it('ignores keyboard moves that would leave the list', () => {
    const { onChange } = mountDeepSeek()
    // The first row cannot move up nor the last move down.
    fireEvent.keyDown(grip(1), { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(grip(2), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves a row with the keyboard and carries its capacity text and open fold', () => {
    const { onChange } = mountDeepSeek()
    expandRow(1)
    fireEvent.change(box(`${en.contextWindow} 1`), { target: { value: '2M' } })

    fireEvent.keyDown(grip(1), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith([
      ROWS[1],
      { ...ROWS[0], contextWindow: 2_000_000 },
    ])
    // The ids swapped, the half-typed buffer re-keyed to the moved row, and
    // the open fold followed it: row 2 is open and shows flash's buffered text.
    expect(box(`${en.modelId} 1`).value).toBe('deepseek-v4-pro')
    expect(box(`${en.contextWindow} 2`).value).toBe('2M')
    expect(screen.queryByLabelText(`${en.contextWindow} 1`)).toBeNull()
  })

  it('moves a row up with the ArrowUp key', () => {
    const { onChange } = mountDeepSeek()
    fireEvent.keyDown(grip(2), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith([ROWS[1], ROWS[0]])
    expect(box(`${en.modelId} 1`).value).toBe('deepseek-v4-pro')
  })

  it('carries a row without an id through a drag payload without a write', () => {
    const { onChange } = mountDeepSeek([{ id: 'flash' }, {}])
    // The second row has no id, so its drag payload is empty; dragging does not
    // itself write anything.
    fireEvent.dragStart(grip(2), { dataTransfer: transfer() })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.dragEnd(grip(2))
  })

  it('moves a row by dragging it under another and marks the insert line', () => {
    const { onChange } = mountDeepSeek()
    fireEvent.dragStart(grip(1), { dataTransfer: transfer() })
    fireEvent.dragOver(box(`${en.modelId} 2`), { dataTransfer: transfer() })
    // jsdom rects are 0×0, so the half falls through to 'after' (pinned on
    // rowHalfOf in the unit spec); the marker hangs below the hovered row.
    expect(dropMarker('after')).toBeTruthy()
    fireEvent.drop(box(`${en.modelId} 2`))
    expect(onChange).toHaveBeenLastCalledWith([ROWS[1], ROWS[0]])
    expect(dropMarker('after')).toBeNull()
  })

  it('marks the line above a row for the pointer\'s top half and inserts there', () => {
    const { onChange } = mountDeepSeek()
    // Force a tall row and a pointer over its top half, so the rect rule picks
    // 'before' (the rule itself is pinned on rowHalfOf in the unit spec).
    const entry = box(`${en.modelId} 1`).closest('[class*="modelEntry"]') as HTMLElement
    vi.spyOn(entry, 'getBoundingClientRect').mockReturnValue({
      top: 100, height: 100, bottom: 200, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.dragStart(grip(2), { dataTransfer: transfer() })
    // jsdom's DragEvent drops clientY from its init, so force it onto the
    // native event; a pointer on the row's top half resolves 'before'.
    const over = createEvent.dragOver(box(`${en.modelId} 1`), { dataTransfer: transfer() })
    Object.defineProperty(over, 'clientY', { value: 0 })
    fireEvent(box(`${en.modelId} 1`), over)
    expect(dropMarker('before')).toBeTruthy()
    // The drop carries the same pointer position, so it resolves the same half.
    const drop = createEvent.drop(box(`${en.modelId} 1`), { dataTransfer: transfer() })
    Object.defineProperty(drop, 'clientY', { value: 0 })
    fireEvent(box(`${en.modelId} 1`), drop)
    // Dropping on the top half of row 1 puts the second row first.
    expect(onChange).toHaveBeenLastCalledWith([ROWS[1], ROWS[0]])
    expect(dropMarker('before')).toBeNull()
  })

  it('writes nothing when the drop lands back on the dragged row', () => {
    const { onChange } = mountDeepSeek()
    fireEvent.dragStart(grip(1), { dataTransfer: transfer() })
    fireEvent.dragOver(box(`${en.modelId} 1`), { dataTransfer: transfer() })
    // Hovering the source row never parks a marker.
    expect(dropMarker('after')).toBeNull()
    expect(dropMarker('before')).toBeNull()
    fireEvent.drop(box(`${en.modelId} 1`))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears the drag state when a drag ends without a drop', () => {
    const { onChange } = mountDeepSeek()
    fireEvent.dragStart(grip(1), { dataTransfer: transfer() })
    fireEvent.dragOver(box(`${en.modelId} 2`), { dataTransfer: transfer() })
    expect(dropMarker('after')).toBeTruthy()
    fireEvent.dragEnd(grip(1))
    expect(dropMarker('after')).toBeNull()
    // A drop with no in-flight drag is a no-op.
    fireEvent.drop(box(`${en.modelId} 2`))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables the grips and drag affordance on a read-only list', () => {
    mountDeepSeek(ROWS, true)
    expect(grip(1).disabled).toBe(true)
    expect(grip(1).draggable).toBe(false)
  })
})

describe('ModelListEditor modalities and reorder', () => {
  const PI_ROWS: ModelDraft[] = [{ id: 'acme-visual' }, { id: 'acme-text' }]
  const PROBE: ProbeTarget = { settingsNs: 'llm-pi-ai', provider: 'openai' }

  /** Stateful harness, as for the DeepSeek editor. */
  const mountPi = (
    models: readonly ModelDraft[] = PI_ROWS,
    disabled = false,
  ): { onChange: ReturnType<typeof vi.fn> } => {
    const onChange = vi.fn()
    const api = {
      llm: {
        models: vi.fn(() => Promise.resolve({
          result: {
            ok: true,
            value: { groups: [{ id: 'openai', models: [
              { id: 'acme-visual', inputModalities: ['text', 'image'] },
              { id: 'acme-text' },
            ] } ] },
          },
        }) as never),
        discoverModels: vi.fn(),
      },
    }
    const Harness = (): ReturnType<typeof ModelListEditor> => {
      const [rows, setRows] = useState(models)
      return <ModelListEditor
        models={rows}
        overridden
        t={t}
        disabled={disabled}
        onChange={(next) => { setRows(next); onChange(next) }}
        onReset={vi.fn()}
        probe={PROBE}
        api={api as never}
      />
    }
    render(<Harness />)
    return { onChange }
  }

  it('offers a row\'s inherited modalities and stores an override on apply', async () => {
    const { onChange } = mountPi()
    expandRow(1)
    // The catalog entry answers until overridden; it arrives with the wire.
    await waitFor(() => expect(screen.getByText(en.modalityImage)).toBeTruthy())

    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    expect(screen.getByText(en.modalityWarning)).toBeTruthy()
    // Inheriting is meaningful here: an empty selection restores the catalog.
    expect(screen.getByText(en.modalityInheritHint)).toBeTruthy()
    expect(box(en.modalityText).checked).toBe(true)
    expect(box(en.modalityImage).checked).toBe(true)

    fireEvent.click(screen.getByText(en.apply))
    // Applying still writes the override, tagged on the row.
    expect(onChange).toHaveBeenLastCalledWith([
      { ...PI_ROWS[0], input: ['text', 'image'] },
      PI_ROWS[1],
    ])
    expect(screen.getByText(en.modalityCustomTag)).toBeTruthy()

    // Unchecking everything is the inherit path: the field drops entirely.
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    fireEvent.click(box(en.modalityText))
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.apply))
    expect(onChange).toHaveBeenLastCalledWith([PI_ROWS[0], PI_ROWS[1]])
  })

  it('shows the text default for an unknown id and for a field of unknown values', async () => {
    // An empty id and an override of only unknown values both read the default.
    mountPi([{ id: 'mystery' }, { id: 'other', input: ['nope'] }, { id: '' }])
    expandRow(1)
    expandRow(2)
    expandRow(3)
    await waitFor(() => expect(screen.getAllByText(en.modalityText).length).toBe(3))
    expect(screen.getAllByText(en.modalityText).length).toBe(3)
  })

  it('closes the dialog without a write when the user cancels', () => {
    const { onChange } = mountPi()
    expandRow(1)
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.cancel))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByText(en.modalityDialogTitle)).toBeNull()
  })

  it('ignores no-op moves and a drop with no drag in flight', () => {
    const { onChange } = mountPi()
    // The last row cannot move down, nor the first up.
    fireEvent.keyDown(grip(1), { key: 'ArrowUp' })
    fireEvent.keyDown(grip(2), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
    // A drop with no in-flight drag is a no-op.
    fireEvent.drop(box(`${en.modelId} 2`))
    expect(onChange).not.toHaveBeenCalled()
    // Dropping a dragged row back on itself writes nothing.
    fireEvent.dragStart(grip(1), { dataTransfer: transfer() })
    fireEvent.drop(box(`${en.modelId} 1`))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('moves a row with the keyboard and carries its buffered capacity', () => {
    const { onChange } = mountPi()
    expandRow(1)
    fireEvent.change(box(`${en.modelContextWindow} 1`), { target: { value: '65536' } })
    fireEvent.keyDown(grip(1), { key: 'ArrowDown' })

    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'acme-text' },
      { ...PI_ROWS[0], contextWindow: 65536 },
    ])
    expect(box(`${en.modelId} 1`).value).toBe('acme-text')
    expect(box(`${en.modelContextWindow} 2`).value).toBe('65536')
    expect(screen.queryByLabelText(`${en.modelContextWindow} 1`)).toBeNull()
  })

  it('moves a row by drag with the same insert convention', () => {
    const { onChange } = mountPi()
    fireEvent.dragStart(grip(1), { dataTransfer: transfer() })
    fireEvent.dragOver(box(`${en.modelId} 2`), { dataTransfer: transfer() })
    expect(dropMarker('after')).toBeTruthy()
    fireEvent.drop(box(`${en.modelId} 2`))
    expect(onChange).toHaveBeenLastCalledWith([PI_ROWS[1], PI_ROWS[0]])
    expect(dropMarker('after')).toBeNull()
  })

  it('marks the line above a row for the pointer\'s top half and inserts there', () => {
    const { onChange } = mountPi()
    const entry = box(`${en.modelId} 1`).closest('[class*="modelEntry"]') as HTMLElement
    vi.spyOn(entry, 'getBoundingClientRect').mockReturnValue({
      top: 100, height: 100, bottom: 200, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.dragStart(grip(2), { dataTransfer: transfer() })
    const over = createEvent.dragOver(box(`${en.modelId} 1`), { dataTransfer: transfer() })
    Object.defineProperty(over, 'clientY', { value: 0 })
    fireEvent(box(`${en.modelId} 1`), over)
    expect(dropMarker('before')).toBeTruthy()
    const drop = createEvent.drop(box(`${en.modelId} 1`), { dataTransfer: transfer() })
    Object.defineProperty(drop, 'clientY', { value: 0 })
    fireEvent(box(`${en.modelId} 1`), drop)
    expect(onChange).toHaveBeenLastCalledWith([PI_ROWS[1], PI_ROWS[0]])
    expect(dropMarker('before')).toBeNull()
  })

  it('re-anchors an open dialog across a move and a removal', async () => {
    const { onChange } = mountPi()
    expandRow(1)
    // Let the catalog load, which decides the row's start-of-dialog selection.
    await waitFor(() => expect(screen.getByText(en.modalityImage)).toBeTruthy())
    fireEvent.click(screen.getByLabelText(`${en.editModelModalities} 1`))
    // Moving the row the dialog is on keeps the dialog open on the same model.
    fireEvent.keyDown(grip(1), { key: 'ArrowDown' })
    expect(screen.getByText(en.modalityDialogTitle)).toBeTruthy()
    // Removing the row before it shifts the target down again.
    fireEvent.click(screen.getByLabelText(`${en.removeModel} 1`))
    expect(screen.getByText(en.modalityDialogTitle)).toBeTruthy()
    fireEvent.click(box(en.modalityImage))
    fireEvent.click(screen.getByText(en.apply))
    // The surviving row (acme-visual) carries the override.
    expect(onChange).toHaveBeenLastCalledWith([
      { id: 'acme-visual', input: ['text'] },
    ])
  })

  it('disables the grips on a read-only list', () => {
    mountPi(PI_ROWS, true)
    expect(grip(1).disabled).toBe(true)
  })
})
