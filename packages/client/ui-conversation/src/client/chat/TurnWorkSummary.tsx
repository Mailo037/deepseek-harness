// TurnWorkSummary: the completed-turn fold. When a turn closes, its work —
// tool runs, Think rows, mid-turn narration — folds behind one plain line
// carrying the run duration. No border box: a hairline underneath separates
// the fold from what follows, with the chevron at the line's right end.
// Unfolding restores the rows exactly as they streamed; individual tool rows
// keep their own collapsed bodies.

import clsx from 'clsx'
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
  label, children, anchorKey, onExpand,
}: {
  /** The run-duration text (locale-formatted). */
  label: string
  /** Stable scroll anchor while older work enters the closed group. */
  anchorKey?: string
  /** Prioritize missing history when the reader opens the group. */
  onExpand?: (() => void) | undefined
  /** The turn's foldable windows and seats, in flow order. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className={css.turnSummaryBlock} data-turn-summary data-chat-anchor-key={anchorKey}>
      <button
        type="button"
        className={css.turnSummary}
        aria-expanded={open}
        onClick={() => {
          if (!open) onExpand?.()
          setOpen(value => !value)
        }}
      >
        <span>{label}</span>
        <IconChevronDownOutline14 className={clsx(css.turnSummaryChevron, open && css.turnSummaryChevronOpen)} />
      </button>
      {open && children}
    </section>
  )
})
