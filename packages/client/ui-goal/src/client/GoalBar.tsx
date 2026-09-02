/**
 * GoalBar: the goal indicator docked above the message composer (input dock
 * strip). A present goal shows a goal glyph, a phase label, the truncated
 * objective, and icon actions — resume when paused, edit (inline form in the
 * same strip), and clear. Fine-pointer desktops reveal those icons on
 * hover/focus out of flow so hidden actions never reserve text width; touch
 * layouts collapse them into one kebab menu instead, and a tap on the strip
 * body toggles the read view itself. Goal creation lives on
 * the `/goal` command, not here: loading (undefined), no goal (null), and
 * complete goals render nothing. Live state arrives as the projected whole
 * snapshot; the verbs are the injected face.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconGoalOutline16, IconPauseOutline16, IconPlayOutline16,
  IconTrashOutline16, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActionResult, GoalBarActions } from './slots.ts'
import type { GoalKey } from './locales.ts'
import css from './GoalBar.module.css'

export interface GoalBarProps extends GoalBarActions {
  /** Current goal snapshot; undefined = capability absent or loading, null = no goal set. */
  goal: GoalSnapshot | null | undefined
}

/** Strip label keys per visible phase; complete goals render nothing. */
const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
} as const satisfies Record<string, GoalKey>

/**
 * The touch-layout media query GoalBar.module.css uses for its mobile seats
 * (max-width 768px, or a coarse/no-hover pointer). Tap-to-toggle mirrors it:
 * the strip body toggles only where a tap is the primary gesture.
 */
const TOUCH_LAYOUT = '(max-width: 768px), (hover: none), (pointer: coarse)'

/** Grow a textarea to fit its content up to the CSS max-height; shrinks after edits shorten. */
function resizeTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function GoalBar({ goal, onEdit, onPause, onResume, onClear, t }: GoalBarProps & PropsLocale<'goal'>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<GoalSnapshot['id'] | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const pendingRef = useRef(false)
  const objectiveRef = useRef<HTMLTextAreaElement | null>(null)

  // Size the edit field to its initial objective once it mounts, then whenever
  // the draft changes the onChange handler re-measures it.
  useEffect(() => {
    if (editing && objectiveRef.current !== null) resizeTextarea(objectiveRef.current)
  }, [editing])

  // A new goal identity (cleared/completed/replaced externally) invalidates the local edit
  // state: without the reset a surviving draft's Enter would write over the NEW goal.
  const goalId = goal?.id
  useEffect(() => {
    setEditing(false)
    setExpanded(false)
    setActionError(null)
    setClearedGoalId(null)
    setMenuOpen(false)
  }, [goalId])

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same CAS twice.
  const runAction = useCallback(async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }, [])

  const handleEdit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    const result = await runAction(() => onEdit(trimmed))
    if (result?.ok) setEditing(false)
  }, [draft, onEdit, runAction])

  const handleClear = useCallback(async (clearedId: GoalSnapshot['id']) => {
    const result = await runAction(onClear)
    if (result?.ok) setClearedGoalId(clearedId)
  }, [onClear, runAction])

  // Touch layouts toggle the read view by tapping the strip itself; taps on
  // control seats (the kebab, menu rows) never count. The optional matchMedia
  // keeps jsdom and non-browser lanes off this path.
  const handleBarTap = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null) return
    if (typeof window.matchMedia !== 'function' || !window.matchMedia(TOUCH_LAYOUT).matches) return
    setExpanded(prev => !prev)
  }, [])

  // Mobile overflow menu: same verbs as the inline icons, one seat instead of
  // five. The goal snapshot is non-null wherever the menu renders.
  const runMenuAction = useCallback((id: string) => {
    setMenuOpen(false)
    if (goal === null || goal === undefined) return
    if (id === 'expand') { setExpanded(prev => !prev); return }
    if (id === 'pause') { void runAction(onPause); return }
    if (id === 'resume') { void runAction(onResume); return }
    if (id === 'edit') { setDraft(goal.objective); setEditing(true); return }
    if (id === 'clear') void handleClear(goal.id)
  }, [goal, handleClear, onClear, onPause, onResume, runAction])

  // Loading, absent, and complete goals have no strip at all.
  if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === clearedGoalId) return null

  if (editing) {
    return (
      <div className={css.dock} data-goal-bar>
        <div className={css.editBar}>
          <textarea
            ref={objectiveRef}
            className={css.objectiveInput}
            aria-label={t('objective.aria')}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              resizeTextarea(e.currentTarget)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleEdit()
              }
              if (e.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
          {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
          <div className={css.actions}>
            <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconBtn}
                onClick={() => { void handleEdit() }}
                disabled={pending || draft.trim() === ''}
                aria-label={t('action.save')}
              >
                <IconCheckOutline16 size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.iconBtn}
                onClick={() => { setEditing(false) }}
                disabled={pending}
                aria-label={t('action.cancel')}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
  }

  const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined
  const menuItems: MenuEntry[] = [
    { id: 'expand', label: t(expanded ? 'action.collapse' : 'action.expand'), icon: expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 /> },
    ...(goal.phase === 'active'
      ? [{ id: 'pause', label: t('action.pause'), icon: <IconPauseOutline16 size={14} /> }]
      : []),
    ...(goal.phase === 'paused'
      ? [{ id: 'resume', label: t('action.resume'), icon: <IconPlayOutline16 size={14} /> }]
      : []),
    { id: 'edit', label: t('action.edit'), icon: <IconEditOutline16 size={14} /> },
    { id: 'clear', label: t('action.clear'), danger: true, icon: <IconTrashOutline16 size={14} /> },
  ]
  // The verb controls (toggle, pause/resume, edit, clear, kebab) are identical
  // in both layouts; only their surrounding row changes.
  const controls = (
    <>
      <div className={css.actions}>
        <Tooltip label={t(expanded ? 'action.collapse' : 'action.expand')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={() => { setExpanded(prev => !prev) }}
            aria-label={t(expanded ? 'action.collapse' : 'action.expand')}
            aria-expanded={expanded ? 'true' : 'false'}
          >
            {/* Disclosure chevrons (the TodoDock convention): up = expand the
                folded bar, down = collapse the expanded panel. */}
            {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
          </button>
        </Tooltip>
        {goal.phase === 'active' && (
          <Tooltip label={t('action.pause')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void runAction(onPause) }} aria-label={t('action.pause')}>
              <IconPauseOutline16 size={14} />
            </button>
          </Tooltip>
        )}
        {goal.phase === 'paused' && (
          <Tooltip label={t('action.resume')} side="bottom" delayMs={500}>
            <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void runAction(onResume) }} aria-label={t('action.resume')}>
              <IconPlayOutline16 size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconBtn}
            disabled={pending}
            onClick={() => { setDraft(goal.objective); setEditing(true) }}
            aria-label={t('action.edit')}
          >
            <IconEditOutline16 size={14} />
          </button>
        </Tooltip>
        <Tooltip label={t('action.clear')} side="bottom" delayMs={500}>
          <button type="button" className={css.iconBtn} disabled={pending} onClick={() => { void handleClear(goal.id) }} aria-label={t('action.clear')}>
            <IconTrashOutline16 size={14} />
          </button>
        </Tooltip>
      </div>
      {/* Mobile seat: one kebab opens every read-strip verb as a menu row. */}
      <div className={css.menuAnchor}>
        <Menu
          open={menuOpen}
          items={menuItems}
          onSelect={runMenuAction}
          onClose={() => { setMenuOpen(false) }}
          side="top"
          align="end"
          anchor={
            <button
              type="button"
              className={css.iconBtn}
              disabled={pending}
              onClick={() => { setMenuOpen(prev => !prev) }}
              aria-label={t('menu.open')}
              aria-expanded={menuOpen ? 'true' : 'false'}
            >
              <IconEllipsisOutline16 size={14} />
            </button>
          }
        />
      </div>
    </>
  )
  return (
    <div className={css.dock} data-goal-bar>
      {expanded ? (
        /* Expanded (read) layout: the glyph + phase label lead one header row
           with every control at its right end, and the objective gets the full
           card width below instead of competing with them for one line. */
        <div className={`${css.bar} ${css.barExpanded}`} onClick={handleBarTap}>
          <div className={css.headerRow}>
            <span className={css.goalGlyph}><IconGoalOutline16 size={14} /></span>
            <span className={css.label}>{t(PHASE_LABELS[goal.phase])}</span>
            {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
            {controls}
          </div>
          <div className={css.objectiveExpanded}>{goal.objective}</div>
        </div>
      ) : (
        <div className={css.bar} title={title} onClick={handleBarTap}>
          <span className={css.goalGlyph}><IconGoalOutline16 size={14} /></span>
          <span className={css.label}>{t(PHASE_LABELS[goal.phase])}</span>
          <span className={css.objective}>{goal.objective}</span>
          {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
          {controls}
        </div>
      )}
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + the locale seat. */
export type GoalDockProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'> & GoalBarActions & PropsLocale<'goal'>

/** Dock adapter: reads the host-computed 'goal' projection (whole value; absent or null renders nothing). */
export function GoalDock({ useProjection, onEdit, onPause, onResume, onClear, t }: GoalDockProps) {
  const projection = useProjection('goal')
  return (
    <GoalBar
      goal={projection === undefined ? undefined : projection === null ? null : projection.goal}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onClear={onClear}
      t={t}
    />
  )
}
