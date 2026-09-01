/**
 * Row-order operations shared by the provider list and both model editors.
 * The model editors render inside a provider card that `ModelsSection.tsx`
 * mounts, so importing its drag helpers from there would make the import edge
 * cycle; this leaf module is the shared home instead.
 */

/** Which half of a hovered row the pointer is on; the insert marker sits above or below. */
export type RowHalf = 'before' | 'after'

/**
 * Pointer-position half of a row.
 * @param event - a drag event positioned against the hovered row.
 * @returns `before` when the pointer is over the row's top half.
 */
export function rowHalfOf(event: { clientY: number; currentTarget: HTMLElement }): RowHalf {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * The insertion position a drop resolves to, in the post-removal convention
 * {@link movedRows} splices at: the hovered row's top half inserts before it,
 * its bottom half before its successor, and a target behind the dragged row
 * shifts one slot up because that row is removed first.
 * @param from - index of the dragged row.
 * @param over - index and pointer half of the hovered row.
 * @returns the post-removal insertion index; dropping on either half of the
 *   dragged row itself yields `from`, which callers skip as a no-op.
 */
export function insertIndexOf(from: number, over: { index: number; half: RowHalf }): number {
  const anchor = over.half === 'before' ? over.index : over.index + 1
  return from < anchor ? anchor - 1 : anchor
}

/**
 * One row moved to another index: the dragged row is removed first, then
 * spliced in at `to` — the convention {@link insertIndexOf} produces and a
 * keyboard move of ±1 expects.
 * @param rows - the rendered rows.
 * @param from - index of the dragged row.
 * @param to - post-removal insertion index.
 * @returns the reordered copy, or a plain copy when `from` names no row.
 */
export function movedRows<T>(rows: readonly T[], from: number, to: number): T[] {
  const moved = rows[from]
  if (moved === undefined) return [...rows]
  const next = rows.filter((_row, at) => at !== from)
  next.splice(to, 0, moved)
  return next
}

/**
 * Where a row index lands after the row at `from` moves to `to`. The moved
 * row itself lands at `to`; the rows it passes shift one slot toward `from`.
 * @param at - a row index from before the move.
 * @param from - index the row moved out of.
 * @param to - post-removal index the row moved into.
 * @returns the same row's index after the move.
 */
export function indexAfterMove(at: number, from: number, to: number): number {
  if (at === from) return to
  if (from < to) return at > from && at <= to ? at - 1 : at
  return at >= to && at < from ? at + 1 : at
}

/**
 * Where a row index lands after the row at `removed` is deleted.
 * @param at - a row index from before the removal.
 * @param removed - index of the deleted row.
 * @returns the same row's index after the removal, or `undefined` for the
 *   deleted row itself.
 */
export function indexAfterRemove(at: number, removed: number): number | undefined {
  if (at === removed) return undefined
  return at > removed ? at - 1 : at
}

/**
 * Re-key a per-row editing buffer whose keys open with the row index
 * (`${index}:${field}`): rows the operation shifts renumber, and a row the
 * operation deletes drops its buffers.
 * @param editing - the current buffers, keyed by row index.
 * @param moved - a row's new index, or `undefined` when the row is gone.
 * @returns the re-keyed buffers.
 */
export function rekeyEditingBuffers(
  editing: ReadonlyMap<string, string>,
  moved: (at: number) => number | undefined,
): Map<string, string> {
  const next = new Map<string, string>()
  for (const [key, text] of editing) {
    const at = Number(key.slice(0, key.indexOf(':')))
    const to = moved(at)
    // Only the row number moves; the field half of the key is untouched.
    if (to !== undefined) next.set(key.replace(/^\d+/, String(to)), text)
  }
  return next
}

/**
 * Re-index per-row state such as an expanded-row set across the same operation.
 * @param indices - the current per-row marks.
 * @param moved - a row's new index, or `undefined` when the row is gone.
 * @returns the re-indexed marks.
 */
export function reindexRowState(
  indices: ReadonlySet<number>,
  moved: (at: number) => number | undefined,
): Set<number> {
  const next = new Set<number>()
  for (const at of indices) {
    const to = moved(at)
    if (to !== undefined) next.add(to)
  }
  return next
}
