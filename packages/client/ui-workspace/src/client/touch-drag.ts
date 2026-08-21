/**
 * Long-press pointer drag for touch reordering. Native HTML5 drag-and-drop
 * (`draggable` + drag events) has no touch support, so draggable rows get a
 * pointer-based drag: holding a row on a touch screen for {@link LONG_PRESS_MS}
 * arms a drag, moving the finger over sibling rows drives the insert marker
 * through the same per-row closures the desktop DnD path uses, and releasing
 * commits the most recent hover marker.
 *
 * The hook owns a stable registry keyed by the id stamped on each draggable row
 * as `[data-drag-id]`; the owner clears and repopulates it every render with the
 * per-row start/hover/end closures, which are already closed over the correct
 * target. Only touch pointers (`pointerType === 'touch'`) are intercepted;
 * mouse and pen drags keep using the native DnD handlers.
 */

import { useEffect, useRef } from 'react'

/** Hold duration before a touch drag arms. */
export const LONG_PRESS_MS = 400

/** One draggable row the pointer can hover onto during a touch drag. */
export interface TouchDragRow {
  /** Row id, stamped on the element as `[data-drag-id]`. */
  id: string
  /** Arm a drag starting on this row. */
  start: () => void
  /** Report the hovered half (insert line above/below) while over this row. */
  hover: (half: 'before' | 'after') => void
  /** End the drag and commit the last hover marker. */
  end: () => void
}

/** A registry of draggable rows keyed by id, repopulated by the owner each render. */
export type TouchDragRegistry = Map<string, TouchDragRow>

/** Pointer-position half of a row (insert line above or below). */
function rowHalfFrom(clientY: number, rect: DOMRect): 'before' | 'after' {
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/** The nearest draggable row under a pointer target, if any. */
function rowElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('[data-drag-id]') ?? null
}

/**
 * Own the touch long-press drag lifecycle for one scrolling list. Attach the
 * returned `onPointerDown` and `onClickCapture` to the list container; the
 * hook registers document-level move/up/cancel listeners itself so the finger
 * can leave the visible list while dragging, and cancels browser scroll while a
 * drag is armed. The returned `registry` is a stable Map the owner clears and
 * repopulates each render.
 * @returns the stable registry, plus the container pointer-down and
 * click-capture handlers (click-capture suppresses the synthetic tap that
 * follows a committed drag).
 */
export function useTouchDragList(): {
  /** Stable registry the owner clears and repopulates each render. */
  registry: TouchDragRegistry
  /** Attach to the scrolling list container. */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  /** Attach to the scrolling list container; suppresses the tap after a drag. */
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void
} {
  // One stable Map instance: the owner mutates it during render and the
  // document listeners read it by reference, so no re-registration is needed.
  const registry = useRef<TouchDragRegistry>(new Map()).current
  // The active gesture: a pending long-press timer or an armed drag.
  const pending = useRef<{ id: string; timer: number } | null>(null)
  const dragging = useRef<{ id: string } | null>(null)
  const suppressClick = useRef(false)

  useTouchDragListeners(registry, pending, dragging, suppressClick)

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.pointerType !== 'touch') return
    // A press on a row action button arms the menu/create, never a drag.
    if (event.target instanceof Element && event.target.closest('button') !== null) return
    const row = rowElementFromTarget(event.target)
    if (row === null) return
    const id = row.getAttribute('data-drag-id')
    if (id === null || !registry.has(id)) return
    if (pending.current !== null) {
      window.clearTimeout(pending.current.timer)
      pending.current = null
    }
    dragging.current = null
    const source = id
    pending.current = {
      id: source,
      timer: window.setTimeout(() => {
        pending.current = null
        dragging.current = { id: source }
        registry.get(source)?.start()
      }, LONG_PRESS_MS),
    }
  }

  const onClickCapture = (event: React.MouseEvent<HTMLElement>): void => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return { registry, onPointerDown, onClickCapture }
}

/** Document-level listeners for a pending or armed touch drag. */
function useTouchDragListeners(
  registry: TouchDragRegistry,
  pending: { current: { id: string; timer: number } | null },
  dragging: { current: { id: string } | null },
  suppressClick: { current: boolean },
): void {
  useEffect(() => {
    // Route hover to the row under the pointer while a drag is armed; a move
    // before the long-press fires is a scroll (cancel the pending timer).
    const onPointerMove = (event: PointerEvent): void => {
      if (dragging.current === null) {
        if (pending.current !== null) {
          window.clearTimeout(pending.current.timer)
          pending.current = null
        }
        return
      }
      const row = rowElementFromTarget(document.elementFromPoint(event.clientX, event.clientY))
      if (row === null) return
      const id = row.getAttribute('data-drag-id')
      if (id === null || !registry.has(id)) return
      registry.get(id)?.hover(rowHalfFrom(event.clientY, row.getBoundingClientRect()))
    }
    // Non-passive so we can cancel the browser scroll once a drag is armed; a
    // long-press holds still for LONG_PRESS_MS before any pan starts.
    const onTouchMove = (event: TouchEvent): void => {
      if (dragging.current !== null) event.preventDefault()
    }
    const onEnd = (suppressClicked: boolean): void => {
      if (dragging.current !== null) {
        registry.get(dragging.current.id)?.end()
        if (suppressClicked) suppressClick.current = true
        dragging.current = null
      }
      if (pending.current !== null) {
        window.clearTimeout(pending.current.timer)
        pending.current = null
      }
    }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', () => { onEnd(true) })
    document.addEventListener('pointercancel', () => { onEnd(false) })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', () => { onEnd(true) })
      document.removeEventListener('pointercancel', () => { onEnd(false) })
      document.removeEventListener('touchmove', onTouchMove)
    }
  }, [registry, pending, dragging, suppressClick])
}
