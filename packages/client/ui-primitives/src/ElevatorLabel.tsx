import { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import css from './ElevatorLabel.module.css'

/**
 * One-line text that moves a replacement value through a vertically clipped
 * track. The first value is static; later values enter from above as the
 * preceding value exits below. Every replacement receives a new animation
 * element and the track width moves with it, so rapid changes and enclosing
 * pills do not snap. Reduced-motion users receive the replacement without
 * movement.
 * @param props - the current visible value and optional layout class.
 * @returns the label track.
 */
export function ElevatorLabel({ value, className }: { value: string; className?: string | undefined }) {
  const committed = useRef(value)
  const rootRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [incoming, setIncoming] = useState({ value, revision: 0 })
  const [outgoing, setOutgoing] = useState<string | null>(null)
  const [width, setWidth] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (committed.current === value) return
    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      setIncoming(current => ({ value, revision: current.revision + 1 }))
      setOutgoing(null)
      setWidth(undefined)
      committed.current = value
      return
    }

    const root = rootRef.current
    const priorWidth = root?.getBoundingClientRect().width
    const nextWidth = measureRef.current?.getBoundingClientRect().width
    const canTweenWidth = priorWidth !== undefined && nextWidth !== undefined
      && priorWidth > 0 && nextWidth > 0 && Math.abs(priorWidth - nextWidth) >= 0.5
    if (canTweenWidth && root !== null) {
      root.style.width = `${String(priorWidth)}px`
      void root.offsetWidth
      setWidth(priorWidth)
    } else {
      setWidth(undefined)
    }
    setOutgoing(committed.current)
    setIncoming(current => ({ value, revision: current.revision + 1 }))
    committed.current = value

    if (!canTweenWidth) return
    let targetFrame: number | undefined
    const startFrame = window.requestAnimationFrame(() => {
      targetFrame = window.requestAnimationFrame(() => { setWidth(nextWidth) })
    })
    return () => {
      window.cancelAnimationFrame(startFrame)
      if (targetFrame !== undefined) window.cancelAnimationFrame(targetFrame)
    }
  }, [value])

  const finish = (): void => {
    setOutgoing(null)
    setWidth(undefined)
  }

  return (
    <span
      ref={rootRef}
      className={clsx(css.root, className)}
      data-elevator-label=""
      style={width === undefined ? undefined : { width: `${String(width)}px` }}
    >
      {outgoing !== null && <span className={clsx(css.value, css.outgoing)} data-elevator-value="" aria-hidden="true">{outgoing}</span>}
      <span key={incoming.revision} className={clsx(css.value, outgoing !== null && css.incoming)} data-elevator-value="" onAnimationEnd={finish}>{incoming.value}</span>
      <span ref={measureRef} className={css.measure} data-elevator-measure="" data-value={value} aria-hidden="true" />
    </span>
  )
}
