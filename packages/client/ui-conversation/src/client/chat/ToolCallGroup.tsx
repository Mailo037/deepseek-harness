// ToolCallGroup: a bounded scroll window over a contiguous run of tool/think
// rows. The header names the run's LAST action (or "edited files") and swaps
// its action icon for the chevron on hover. The window tracks activity: while
// any call inside runs it stays open under the max-height scrollport; when the
// run settles it tucks back to the header line on its own. A reader's manual
// hide is sticky — arriving activity never reopens it, only their click does.

import { memo, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChatView.module.css'

/** Visibility flavors: `auto` reopens on the next activity, `manual` never does. */
type WindowVisibility = 'open' | 'auto' | 'manual'

/**
 * Render one bounded tool/think window with its last-action header.
 * @param props - header icon, header label, live-activity flag, and the seats.
 * @returns the header plus the scroll-bounded tool window.
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  icon, label, active, children,
}: {
  /** Leading icon for the run's last action family. */
  icon: ReactNode
  /** Header text: the last action, or the edited-files summary. */
  label: string
  /** Whether any call inside the window is still running. */
  active: boolean
  /** The tool/think seats, rendered in display order inside the window. */
  children: ReactNode
}) {
  const [visibility, setVisibility] = useState<WindowVisibility>(() => active ? 'open' : 'auto')
  const prevActive = useRef(active)
  useEffect(() => {
    setVisibility((current) => {
      if (current === 'manual') return current
      if (active) return 'open'
      return prevActive.current ? 'auto' : current
    })
    prevActive.current = active
  }, [active])
  const hidden = visibility !== 'open'
  return (
    <div className={css.toolGroup} data-tool-group data-hidden={hidden || undefined}>
      <button
        type="button"
        className={css.toolGroupToggle}
        aria-expanded={!hidden}
        onClick={() => setVisibility(value => value === 'open' ? 'manual' : 'open')}
      >
        <span className={css.leadingSwap}>
          <span className={css.idleLead}>{icon}</span>
          <IconChevronDownOutline14 className={css.hoverChevron} />
        </span>
        <span>{label}</span>
      </button>
      {!hidden && <div data-tool-scroll className={css.toolGroupScroll}>{children}</div>}
    </div>
  )
})
