/**
 * Sidebar-local archive notices. They preserve the reversible archive action
 * while compacting several results into one Motion-driven card deck.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { IconArchiveOutline20, IconCloseOutline16, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import css from './ArchiveNotificationStack.module.css'

/** One archive outcome before the deck assigns its display identity. */
export type ArchiveNotificationDraft = {
  sessionId: SessionId
} & ({ kind: 'archived' } | { kind: 'archive-failure'; message: string } | { kind: 'restore-failure'; message: string })

/** One completed archive operation that remains actionable from the deck. */
export type ArchiveNotification = ArchiveNotificationDraft & { id: number }

/** Render the centered archive notification deck at the sidebar bottom. */
export function ArchiveNotificationStack({
  notifications, pendingIds, onDismiss, onUndo, onRetryArchive, onRetryRestore, t,
}: {
  notifications: readonly ArchiveNotification[]
  pendingIds: ReadonlySet<number>
  onDismiss: (id: number) => void
  onUndo: (notification: ArchiveNotification) => void
  onRetryArchive: (notification: ArchiveNotification) => void
  onRetryRestore: (notification: ArchiveNotification) => void
  t: WorkspaceBrowserProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const reduceMotion = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  // The newest result stays on top. Opening the deck reveals the preserved
  // chronological order without changing which action is nearest the pointer.
  const cards = [...notifications].reverse()
  const stacked = cards.length > 1
  const open = expanded && stacked
  useDismissOnOutsidePointer(rootRef, open, setExpanded)
  useEffect(() => {
    if (!stacked) setExpanded(false)
  }, [stacked])
  if (cards.length === 0) return null

  const onStackClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!stacked) return
    if ((event.target as Element).closest('button')) return
    setExpanded(value => !value)
  }

  const onStackKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setExpanded(false)
      return
    }
    if (!stacked || event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setExpanded(value => !value)
    }
  }

  return (
    <div
      ref={rootRef}
      className={css.stack}
      data-stacked={stacked || undefined}
      data-expanded={open || undefined}
      aria-label={t('archive.notifications.aria')}
      aria-expanded={stacked ? open : undefined}
      tabIndex={stacked ? 0 : undefined}
      onClick={onStackClick}
      onKeyDown={onStackKeyDown}
    >
      <AnimatePresence initial={false}>
        {cards.map((notification, index) => {
          const pending = pendingIds.has(notification.id)
          const failure = notification.kind !== 'archived'
          const compact = !open && index > 0
          const text = notification.kind === 'archived'
            ? t('archive.undoMessage')
            : notification.kind === 'archive-failure'
              ? t('archive.failure', { message: notification.message })
              : t('archive.restoreFailure', { message: notification.message })
          const action = notification.kind === 'archived'
            ? t('archive.undo')
            : t('archive.retry')
          const run = () => {
            if (notification.kind === 'archived') onUndo(notification)
            else if (notification.kind === 'archive-failure') onRetryArchive(notification)
            else onRetryRestore(notification)
          }
          return (
            <motion.div
              key={notification.id}
              className={failure ? `${css.card} ${css.failure}` : css.card}
              role={failure ? 'alert' : 'status'}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
              animate={{
                opacity: compact ? Math.max(0.4, 0.8 - index * 0.16) : 1,
                scale: compact ? 1 - index * 0.035 : 1,
                y: open ? -index * 52 : -index * 6,
              }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 32, mass: 0.72 }}
              style={{ zIndex: cards.length - index, pointerEvents: compact ? 'none' : 'auto' }}
            >
              <span className={css.icon} aria-hidden><IconArchiveOutline20 size={16} /></span>
              <span className={css.text}>{text}</span>
              <button type="button" className={css.action} disabled={pending} onClick={run}>
                {pending ? t('archive.pending') : action}
              </button>
              <button
                type="button"
                className={css.dismiss}
                aria-label={t('archive.dismiss')}
                disabled={pending}
                onClick={() => { onDismiss(notification.id) }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
