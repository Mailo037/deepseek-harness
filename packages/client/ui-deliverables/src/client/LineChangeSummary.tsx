// LineChangeSummary: one composer-adjacent readout of successful applied
// diffs. It derives all values from the current Conversation timeline and
// keeps its disclosure state local to the rendered Session scope.

import { useEffect, useId, useRef, useState } from 'react'
import { BottomSheet, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { basename, summarizeLineChanges } from './turn-deliverables.ts'
import css from './LineChangeSummary.module.css'

/** Phone breakpoint: the same capped-width gate the composer uses for its
 *  phone folds, so the file breakdown drops into a bottom sheet in the same band. */
const MOBILE_QUERY = '(max-width: 639px)'

/** Full composer-dock props: the current Session snapshot plus this package's locale seat. */
export type LineChangeSummaryProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS>

/** Render a file's short name first while retaining its full path for disambiguation. */
function FilePath({ path }: { readonly path: string }) {
  const name = basename(path)
  if (name === path) return <span className={css.name}>{name}</span>
  return (
    <span className={css.file} aria-label={path}>
      <span className={css.name}>{name}</span>
      <span className={css.separator} aria-hidden="true">·</span>
      <span className={css.path}>{path}</span>
    </span>
  )
}

/**
 * Render the current Session's line-change total and its path breakdown.
 * @param props - input-dock owner snapshot and localized copy.
 * @returns Nothing without successful applied diffs, otherwise the summary disclosure.
 */
export function LineChangeSummary({ session, t }: LineChangeSummaryProps) {
  const summary = summarizeLineChanges(session.chat.timeline)
  const [open, setOpen] = useState(false)
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
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (summary.files.length === 0 && open) setOpen(false)
  }, [open, summary.files.length])

  useEffect(() => {
    // On phone the bottom sheet's mask owns outside dismissal; this pointer
    // listener would otherwise fire on the portaled sheet content.
    if (!open || phone) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, phone])

  if (summary.files.length === 0) return null
  const fileLabel = summary.files.length === 1
    ? t('changes.summaryOne', { count: summary.files.length })
    : t('changes.summary', { count: summary.files.length })
  const reading = t('changes.aria', {
    files: summary.files.length,
    added: summary.added,
    removed: summary.removed,
  })

  /** One file breakdown list, reused by the desktop panel and the phone sheet. */
  const fileList = (
    <ul className={css.list}>
      {summary.files.map(file => (
        <li key={file.path} className={css.row} title={file.path}>
          <FilePath path={file.path} />
          <span className={css.counts}>
            <span className={css.added}>+{file.added}</span>
            <span className={css.removed}>-{file.removed}</span>
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <div ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-label={reading}
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.label}>{fileLabel}</span>
        <span className={css.added}>+{summary.added}</span>
        <span className={css.removed}>-{summary.removed}</span>
        <IconChevronDownOutline14 className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {phone
        ? (
          <BottomSheet
            open={open}
            onClose={() => { setOpen(false) }}
            title={reading}
            closeLabel={t('changes.close')}
            bodyClassName={css.sheetBody}
          >
            {fileList}
          </BottomSheet>
        )
        : open && (
          <div id={panelId} className={css.panel} role="dialog" aria-label={reading}>
            {fileList}
          </div>
        )}
    </div>
  )
}
