// TurnWorkSummary: the completed-turn fold. When a turn closes, its work —
// tool runs, Think rows, mid-turn narration — folds behind one plain line
// carrying the run duration. No border box: a hairline underneath separates
// the fold from what follows and carries the unfold affordance. The leading
// slot stays empty at rest and shows the chevron on hover/focus. Unfolding
// restores the rows exactly as they streamed; individual tool rows keep
// their own collapsed bodies.

import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChatView.module.css'

/**
 * Render one completed turn's collapsed work fold.
 * @param props - the duration label and the turn's foldable seats/windows.
 * @returns the duration line with its separator, plus the work when open.
 */
export const TurnWorkSummary = memo(function TurnWorkSummary({
  label, children,
}: {
  /** The run-duration text (locale-formatted). */
  label: string
  /** The turn's foldable windows and seats, in flow order. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className={css.turnSummaryBlock} data-turn-summary>
      <button
        type="button"
        className={css.turnSummary}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className={css.leadingSwap}>
          <span className={css.idleLead} />
          <IconChevronDownOutline14 className={css.hoverChevron} />
        </span>
        <span>{label}</span>
      </button>
      {open && children}
    </section>
  )
})
