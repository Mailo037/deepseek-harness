/**
 * Pull-to-refresh gesture for touch devices. Attaches non-passive touch
 * listeners to the container element; the gesture engages when the user
 * pulls down past a threshold while the current scroll root
 * ([data-pull-scroll-root]) is at scrollTop 0. Engages for touch pointers
 * only and requires vertical-dominant movement.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

/** Vertical distance (px) before the gesture arms, avoiding accidental pulls. */
const PULL_ENGAGE_PX = 8

/** Release distance that triggers the refresh. */
export const PULL_TRIGGER_PX = 64

/** Maximum pull distance (rubber-band ceiling). */
const PULL_MAX_PX = 96

/** Height the indicator holds while refreshing. */
const PULL_REST_PX = 40

/** Current pull-to-refresh gesture phase. */
export type PullPhase = 'idle' | 'pulling' | 'refreshing'

/** Render state exposed by the pull-to-refresh hook. */
export interface PullState {
  /** Current gesture phase. */
  phase: PullPhase
  /** Current vertical pull distance in pixels. */
  distance: number
}

interface Gesture {
  startY: number
  startX: number
  armed: boolean
}

/**
 * Hook to implement pull-to-refresh on a scroll container.
 * @param containerRef - ref to the element that receives touch listeners.
 * @param onRefresh - function called when the gesture completes.
 * @returns the current pull state for the indicator.
 */
export function usePullToRefresh(
  containerRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
): PullState {
  const [state, setState] = useState<PullState>({ phase: 'idle', distance: 0 })
  const gestureRef = useRef<Gesture | null>(null)
  const refreshingRef = useRef(false)
  const distanceRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const el = containerRef.current
    if (el === null) return

    const scrollRootFrom = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null
      return target.closest('[data-pull-scroll-root]')
    }

    const onTouchStart = (event: TouchEvent): void => {
      if (refreshingRef.current || event.touches.length !== 1) return
      const touch = event.touches[0]
      if (touch === undefined) return
      gestureRef.current = { startY: touch.clientY, startX: touch.clientX, armed: false }
    }

    const onTouchMove = (event: TouchEvent): void => {
      const g = gestureRef.current
      if (g === null) return
      const touch = event.touches[0]
      if (touch === undefined || event.touches.length !== 1) return
      const dy = touch.clientY - g.startY
      const dx = touch.clientX - g.startX

      if (!g.armed) {
        if (dy <= PULL_ENGAGE_PX || Math.abs(dx) > Math.abs(dy)) return
        const scrollRoot = scrollRootFrom(event.target)
        if (scrollRoot === null || scrollRoot.scrollTop > 0) return
        g.armed = true
      }

      // Prevent native scroll / overscroll while engaged.
      event.preventDefault()

      const damped = Math.min(dy * 0.5, PULL_MAX_PX)
      distanceRef.current = damped
      setState({ phase: 'pulling', distance: damped })
    }

    const onTouchEnd = (): void => {
      const g = gestureRef.current
      gestureRef.current = null
      if (g === null || !g.armed) return

      const d = distanceRef.current
      distanceRef.current = 0
      if (d >= PULL_TRIGGER_PX) {
        refreshingRef.current = true
        setState({ phase: 'refreshing', distance: PULL_REST_PX })
        void onRefreshRef.current().finally(() => {
          refreshingRef.current = false
          setState({ phase: 'idle', distance: 0 })
        })
      } else {
        setState({ phase: 'idle', distance: 0 })
      }
    }

    const onTouchCancel = (): void => {
      gestureRef.current = null
      distanceRef.current = 0
      setState({ phase: 'idle', distance: 0 })
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [containerRef])

  return state
}
