// ToolCallGroup: a collapsible window over a contiguous run of tool/think
// rows. The header names the run's LAST action (or "edited files") and swaps
// its action icon for the chevron on hover. The window tracks activity: while
// any call inside runs it opens (if not hidden) and, once opened, stays open —
// it waits on the next action rather than tucking shut and re-opening
// mid-turn. A reader's manual hide is sticky — arriving activity never
// reopens it, only their click does.

import { memo, useEffect, useState, type ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChatView.module.css'

/** Visibility flavors: `open` shows the window; `manual` is a reader hide that
 *  arriving activity never overrides. */
type WindowVisibility = 'open' | 'manual'

/**
 * Render one bounded tool/think window with its last-action header.
 * @param props - header icon, header label, live-activity flag, and the seats.
 * @returns the header plus the tool window body.
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
  const [visibility, setVisibility] = useState<WindowVisibility>(() => active ? 'open' : 'manual')
  useEffect(() => {
    // A call running inside opens the window unless the reader hid it
    // manually. A settled group stays however the reader left it: once opened,
    // it waits on the next action instead of tucking shut and re-opening
    // mid-turn.
    if (!active) return
    setVisibility(current => (current === 'manual' ? current : 'open'))
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
      {!hidden && <div data-tool-scroll className={css.toolGroupBody}>{children}</div>}
    </div>
  )
})
