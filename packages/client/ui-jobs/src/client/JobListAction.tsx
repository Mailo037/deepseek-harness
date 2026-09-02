import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { BottomSheet, IconChevronDownOutline14, StateDot, useDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './JobListAction.module.css'

/** Injected capability to kill jobs and fetch logs. */
export interface JobListActionInjected {
  killJob?(this: void, sessionId: SessionId, jobId: JobId): Promise<void>
  getJobOutput?(this: void, sessionId: SessionId, jobId: JobId): Promise<{ text: string; status: JobView['status']; detail?: string }>
}

/** Phone breakpoint: the same capped-width gate the composer uses for its
 *  phone folds, so the list drops into a bottom sheet in the same band. */
const MOBILE_QUERY = '(max-width: 639px)'

/** Full props for the session-header background-job action. */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'> & JobListActionInjected & PropsLocale<typeof NS>

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS: readonly JobView[] = []

/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/**
 * Status marker semantics. `stopping` and `killed` share the attention color:
 * both mean the work ended (or is ending) on request rather than on its own.
 */
function dotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Human status word for the row and its accessible name. */
function statusLabel(status: JobView['status'], t: TranslateNS<typeof NS>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * Elapsed time in at most two adjacent units.
 */
function formatDuration(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/**
 * Live rows first in start order, then settled rows newest-first.
 */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/**
 * Session-header entry point for this session's background jobs with stopping & logs inspection.
 */
export function JobListAction({ sessionId, useSessions, killJob, getJobOutput, t }: JobListActionProps) {
  const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [activeLogJob, setActiveLogJob] = useState<JobView | null>(null)
  const [logText, setLogText] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const [stoppingIds, setStoppingIds] = useState<Set<JobId>>(() => new Set())
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => ordered(jobs), [jobs])
  const liveCount = useMemo(() => jobs.filter(isLive).length, [jobs])

  // On phone the bottom sheet's mask owns outside dismissal, so the popover's
  // outside-pointer listener is disabled (it would otherwise fire on the sheet
  // content, which is portaled outside the root).
  useDismissOnOutsidePointer(rootRef, open && !phone, setOpen)

  // Clock for duration tickers
  useEffect(() => {
    if ((!open && !activeLogJob) || liveCount === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, activeLogJob, liveCount])

  // Log fetch & polling
  useEffect(() => {
    if (!activeLogJob || !getJobOutput) return
    let active = true

    const fetchLogs = async () => {
      try {
        const res = await getJobOutput(sessionId, activeLogJob.id)
        if (active) {
          setLogText(res.text || (res.detail ? `[detail: ${res.detail}]` : ''))
        }
      } catch {
        if (active) setLogText(t('logs.empty'))
      }
    }

    void fetchLogs()
    // Poll output while job is running
    const timer = setInterval(() => {
      if (isLive(activeLogJob)) {
        void fetchLogs()
      }
    }, 1_500)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [activeLogJob, sessionId, getJobOutput, t])

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logText])

  // Clean up if job disappears
  useEffect(() => {
    if (jobs.length === 0 && open) setOpen(false)
    if (activeLogJob && !jobs.some(j => j.id === activeLogJob.id)) {
      setActiveLogJob(null)
    }
  }, [jobs, open, activeLogJob])

  if (jobs.length === 0) return null

  const countKey = liveCount > 0
    ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
    : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
  const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKill = async (job: JobView, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!killJob || stoppingIds.has(job.id)) return
    setStoppingIds(prev => new Set(prev).add(job.id))
    try {
      await killJob(sessionId, job.id)
    } finally {
      // stopping state will arrive via jobs stream
    }
  }

  const handleCopyLogs = async () => {
    if (!logText) return
    await navigator.clipboard.writeText(logText)
    setCopied(true)
    setTimeout(() => { setCopied(false) }, 2_000)
  }

  /** One list surface, reused by the desktop popover and the phone bottom sheet. */
  const renderRows = (listClass: string | undefined): ReactNode => (
    <ul className={listClass} aria-label={t('list.aria')}>
      {rows.map((job) => {
        const live = isLive(job)
        const isStopping = stoppingIds.has(job.id) || job.status === 'stopping'
        const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
        const duration = formatDuration(elapsed, t)
        const status = isStopping ? t('status.stopping') : statusLabel(job.status, t)

        return (
          <li
            key={job.id}
            className={live ? css.row : `${css.row} ${css.rowSettled}`}
            tabIndex={0}
            onClick={() => {
              setActiveLogJob(job)
              setOpen(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveLogJob(job)
                setOpen(false)
              }
            }}
          >
            <StateDot state={dotState(job.status)} className={css.rowDot} />
            <span className={css.kind}>{job.kind}</span>
            <span className={css.label} title={job.label}>{job.label}</span>
            <span className={css.status} title={job.detail ?? status}>{job.detail ?? status}</span>
            <span
              className={css.duration}
              title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
            >
              {duration}
            </span>

            <div className={css.actions}>
              {live && killJob ? (
                <button
                  type="button"
                  className={`${css.actionBtn} ${css.killBtn} ${css.iconOnlyBtn}`}
                  title={t('actions.kill')}
                  aria-label={t('actions.kill')}
                  disabled={isStopping}
                  onClick={e => void handleKill(job, e)}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
                  </svg>
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        onClick={() => {
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
        <span className={css.count}>{countLabel}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>

      {phone
        ? (
          <BottomSheet
            open={open}
            onClose={() => { setOpen(false) }}
            title={t('list.aria')}
            closeLabel={t('actions.close')}
            bodyClassName={css.sheetBody}
          >
            {renderRows(css.sheetList)}
          </BottomSheet>
        )
        : open
          ? renderRows(css.menu)
          : null}

      {/* Subagent-styled Log Modal Dialog with Breadcrumbs and Line Numbers */}
      {activeLogJob ? (
        <div className={css.modalBackdrop} onClick={() => { setActiveLogJob(null) }}>
          <div className={css.modalCard} onClick={(e) => { e.stopPropagation() }}>
            <div className={css.modalHeader}>
              <nav className={css.modalBreadcrumbs} aria-label="Hierarchy">
                <span className={css.crumbItem}>
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" className={css.crumbIcon}>
                    <rect x="2" y="2" width="12" height="12" rx="2" />
                    <path d="M5 6l2.5 2L5 10M9 10h2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{t('list.aria')}</span>
                </span>
                <span className={css.crumbSep}>/</span>
                <span className={css.crumbKind}>{activeLogJob.kind}</span>
                <span className={css.crumbSep}>/</span>
                <span className={css.crumbCurrent} title={activeLogJob.label}>{activeLogJob.label}</span>
              </nav>

              <div className={css.modalHeaderActions}>
                <div className={css.statusBadge}>
                  <StateDot state={dotState(activeLogJob.status)} />
                  <span>{statusLabel(activeLogJob.status, t)}</span>
                </div>

                {isLive(activeLogJob) && killJob ? (
                  <button
                    type="button"
                    className={`${css.actionBtn} ${css.killBtn}`}
                    title={t('actions.kill')}
                    onClick={e => void handleKill(activeLogJob, e)}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
                    </svg>
                    <span>{t('actions.kill')}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={css.actionBtn}
                  onClick={() => void handleCopyLogs()}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" strokeLinecap="round" />
                  </svg>
                  <span>{copied ? t('actions.copied') : t('actions.copy')}</span>
                </button>
                <button
                  type="button"
                  className={css.closeBtn}
                  aria-label={t('actions.close')}
                  onClick={() => { setActiveLogJob(null) }}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={css.modalBody} ref={logContainerRef}>
              {logText ? (
                <table className={css.terminalTable}>
                  <tbody>
                    {logText.split('\n').map((line, idx) => (
                      <tr key={idx} className={css.terminalRow}>
                        <td className={css.lineNumber}>{idx + 1}</td>
                        <td className={css.lineContent}>{line || ' '}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={css.emptyLogs}>{t('logs.empty')}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
