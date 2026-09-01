// BottomSheet: the mobile reading surface for content that on desktop would
// expand inline (tool-call bodies, long payloads). It rests at the viewport's
// bottom edge at half height, slides up on open, and can be dragged between
// that "rest" height and a near-fullscreen "expanded" height, or pulled down
// past a dismiss threshold to close. It portals to this document's body so an
// owner inside a transformed or filtered ancestor cannot trap the fixed sheet
// in that ancestor's box.
//
// The primitive is controlled by `open`, but closing is animated: when `open`
// goes false the sheet stays mounted through a slide-down (and a mask fade)
// before unmounting, so dismissing is a gesture rather than an instant
// removal. Callers must therefore keep the component mounted while they might
// show it (render `<BottomSheet open={...}>` unconditionally, not gated on
// `open`), and drive visibility purely through the `open` prop.
//
// Children are ordinary React output of the owner, so they re-render whenever
// the owner does — a sheet built over a streaming source stays current rather
// than freezing a snapshot at open time.

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseFill14 } from './icons/index.tsx'
import css from './BottomSheet.module.css'

/** Sheet heights as a fraction of the viewport height. */
const SHEET_REST_RATIO = 0.5
const SHEET_EXPAND_RATIO = 0.92
/** Dragging below this fraction of the viewport height dismisses the sheet. */
const SHEET_DISMISS_RATIO = 0.25
/** Drag past the midpoint between rest and expanded snaps the sheet to expanded. */
const SHEET_SNAP_MID_RATIO = (SHEET_REST_RATIO + SHEET_EXPAND_RATIO) / 2
/** Close-animation duration; must match the slide-down (240ms) in the CSS. */
const SHEET_TRANSITION_MS = 240

/** Inline style that also accepts the `--sheet-h` custom property, which
 *  React's `CSSProperties` omits from its `--` index signature. */
type SheetStyle = CSSProperties & { [key: `--${string}`]: string }

export interface BottomSheetProps {
  /** Whether the sheet is showing. Controlled by the owner. */
  open: boolean
  /** Called on Escape, mask tap, close button, or a drag past the dismiss threshold. */
  onClose: () => void
  /** Panel heading; also the dialog's accessible name. */
  title: string
  /** Accessible close-button label. */
  closeLabel?: string
  /** Body content. Live: it re-renders with the owner, so it never goes stale. */
  children?: ReactNode
  /** Extra sheet class; CSS-module members are `string | undefined`, so it
   *  accepts `undefined` under `exactOptionalPropertyTypes`. */
  className?: string | undefined
  /** Extra body class; accepts `undefined` for the same reason. */
  bodyClassName?: string | undefined
}

/**
 * Render a draggable bottom sheet over a blurred page mask.
 * @param props - controlled visibility, close callback, title, and body.
 * @returns null when closed (and once the close animation has finished); the
 *   mask plus sheet portal otherwise.
 */
export function BottomSheet({
  open, onClose, title, closeLabel = 'Close', children, className, bodyClassName,
}: BottomSheetProps) {
  const [snap, setSnap] = useState<'rest' | 'expanded'>('rest')
  const [dragging, setDragging] = useState(false)
  // `mounted` is whether the surface is still in the DOM (open, or animating
  // out); `closing` drives the slide-down/reverse animation. The ref guards
  // against a stray render restarting the close timer.
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const dragStartRef = useRef<{ y: number; h: number } | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  // Open shows the sheet; an open→close keeps it mounted through the slide-down
  // animation before unmounting. Re-opening mid-close cancels the pending hide.
  useEffect(() => {
    if (open) {
      closingRef.current = false
      setClosing(false)
      setMounted(true)
      return
    }
    if (!mounted || closingRef.current) return
    closingRef.current = true
    setClosing(true)
    const timer = setTimeout(() => {
      closingRef.current = false
      setMounted(false)
      setClosing(false)
    }, SHEET_TRANSITION_MS)
    return () => { clearTimeout(timer) }
  }, [open, mounted])

  // The page scroll is locked for the sheet's whole visible lifetime.
  useEffect(() => {
    if (!mounted) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mounted])

  // Escape closes only while fully open (not mid slide-down).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])

  // Each open starts at the rest height; a close/reopen never inherits the
  // previous drag's expanded state.
  useEffect(() => {
    if (open) setSnap('rest')
  }, [open])

  // Move focus into the sheet when it opens.
  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  if (!mounted) return null

  // The sheet's height is driven by the `--sheet-h` custom property; while
  // dragging it is written straight to the element so the sheet tracks the
  // finger without a re-render per move, and on release it snaps to rest or
  // expanded (or dismisses past the threshold) through the height transition.
  // `setPointerCapture` is guarded because jsdom ships a throwing stub.
  const onHandleDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (sheetRef.current === null) return
    dragStartRef.current = { y: event.clientY, h: sheetRef.current.getBoundingClientRect().height }
    setDragging(true)
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* jsdom lacks capture */ }
    }
  }
  const onHandleMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragStartRef.current
    if (start === null || sheetRef.current === null) return
    const vh = window.innerHeight
    const h = Math.max(0, Math.min(start.h - (event.clientY - start.y), vh * SHEET_EXPAND_RATIO))
    sheetRef.current.style.setProperty('--sheet-h', `${h}px`)
  }
  const onHandleUp = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragStartRef.current
    const sheet = sheetRef.current
    dragStartRef.current = null
    if (start === null || sheet === null) return
    const vh = window.innerHeight
    const h = Math.max(0, start.h - (event.clientY - start.y))
    setDragging(false)
    if (h <= vh * SHEET_DISMISS_RATIO) {
      onClose()
      return
    }
    const next: 'rest' | 'expanded' = h >= vh * SHEET_SNAP_MID_RATIO ? 'expanded' : 'rest'
    sheet.style.setProperty('--sheet-h', next === 'expanded'
      ? `${vh * SHEET_EXPAND_RATIO}px`
      : `${vh * SHEET_REST_RATIO}px`)
    setSnap(next)
  }

  const sheetStyle: SheetStyle = {
    '--sheet-h': `${Math.round((snap === 'expanded' ? SHEET_EXPAND_RATIO : SHEET_REST_RATIO) * 100)}dvh`,
  }

  return createPortal((
    <div className={clsx(css.root, closing && css.closing)} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        className={clsx(css.sheet, className, dragging && css.dragging)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={sheetStyle}
      >
        <div
          className={css.handle}
          role="presentation"
          data-sheet-handle=""
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span className={css.handleBar} />
        </div>
        <div className={css.header}>
          <span className={css.title}>{title}</span>
          <button
            type="button"
            className={css.close}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <IconCloseFill14 size={16} />
          </button>
        </div>
        <div className={clsx(css.body, bodyClassName)}>{children}</div>
      </div>
    </div>
  ), document.body)
}
