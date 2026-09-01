// ToolCallGroup: a collapsible window over a contiguous run of tool/think
// rows. The header names the run's LAST action (or "edited files") and swaps
// its action icon for the chevron on hover. The window tracks activity: while
// any call inside runs it opens (if not hidden) and, once opened, stays open —
// it waits on the next action rather than tucking shut and re-opening
// mid-turn. A reader's manual hide is sticky — arriving activity never
// reopens it, only their click does.
//
// On a phone viewport the window body never expands inline: the header is the
// tap target for a bottom sheet holding the group's rows in display order, so
// a run of calls overlays the conversation instead of pushing it down. Each
// row inside keeps its own phone bottom-sheet behavior, so tapping a row opens
// that call's body sheet on top.

import { memo, useEffect, useState, type ReactNode } from 'react'
import { BottomSheet, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ChatView.module.css'

/** Phone breakpoint: the same capped-width gate the composer uses for its
 *  phone folds, so the tool window drops into a bottom sheet in the same band. */
const MOBILE_QUERY = '(max-width: 639px)'

/** Visibility flavors: `open` shows the window; `manual` is a reader hide that
 *  arriving activity never overrides. */
type WindowVisibility = 'open' | 'manual'

/**
 * Render one bounded tool/think window with its last-action header.
 * @param props - header icon, header label, live-activity flag, the seats, and
 *   the sheet close-button label on phone.
 * @returns the header, plus the tool window body inline or in a phone sheet.
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  icon, label, active, children, closeLabel,
}: {
  /** Leading icon for the run's last action family. */
  icon: ReactNode
  /** Header text: the last action, or the edited-files summary. */
  label: string
  /** Whether any call inside the window is still running. */
  active: boolean
  /** The tool/think seats, rendered in display order inside the window. */
  children: ReactNode
  /** Close-button label for the phone sheet; absent means the group never
   *  uses the sheet (never the case in the conversation, but keeps the prim. */
  closeLabel?: string
}) {
  const [visibility, setVisibility] = useState<WindowVisibility>(() => active ? 'open' : 'manual')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches,
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = (): void => { setPhone(query.matches) }
    query.addEventListener('change', onChange)
    return () => { query.removeEventListener('change', onChange) }
  }, [])
  useEffect(() => {
    // A call running inside opens the window unless the reader hid it
    // manually. A settled group stays however the reader left it: once opened,
    // it waits on the next action instead of tucking shut and re-opening
    // mid-turn. (On phone the window is a sheet opened on tap, so this only
    // drives the desktop inline visibility.)
    if (!active) return
    setVisibility(current => (current === 'manual' ? current : 'open'))
  }, [active])
  const hidden = phone ? true : visibility !== 'open'
  return (
    <div className={css.toolGroup} data-tool-group data-hidden={hidden || undefined}>
      <button
        type="button"
        className={css.toolGroupToggle}
        aria-expanded={phone ? sheetOpen : !hidden}
        onClick={() => {
          if (phone) {
            setSheetOpen(true)
            return
          }
          setVisibility(value => value === 'open' ? 'manual' : 'open')
        }}
      >
        <span className={css.leadingSwap}>
          <span className={css.idleLead}>{icon}</span>
          <IconChevronDownOutline14 className={css.hoverChevron} />
        </span>
        <span>{label}</span>
      </button>
      {!phone && !hidden && <div data-tool-scroll className={css.toolGroupBody}>{children}</div>}
      {phone && (
        <BottomSheet
          open={sheetOpen}
          onClose={() => { setSheetOpen(false) }}
          title={label}
          closeLabel={closeLabel ?? 'Close'}
        >
          <div data-group-sheet className={css.sheetBody}>{children}</div>
        </BottomSheet>
      )}
    </div>
  )
})
