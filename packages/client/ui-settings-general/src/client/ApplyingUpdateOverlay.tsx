/** Detached self-update status and logs projected over the shell during reconnect. */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: imports the layout-owned `shell.overlay` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsKey } from './locales.ts'
import type { UpdateState } from './update-store.ts'
import css from './ApplyingUpdateOverlay.module.css'

const UPDATE_STATUS_PATH = '/__dsh_update/status'
const UPDATE_POLL_MS = 500
const UPDATE_REFRESH_PARAM = '__dsh_update'

type RunnerPhase = 'waiting' | 'pulling' | 'building' | 'starting' | 'failed'

interface RunnerProgress {
  updateId: string
  phase: RunnerPhase
  status: string
  logs: UpdateLogLine[]
  logLimit: number
  issueUrl: string
  error?: string
}

interface UpdateLogLine {
  seq: number
  stream: 'system' | 'stdout' | 'stderr'
  text: string
}

const CLIENT_LOG_LIMIT = 100
const CLIENT_LOG_LINE_MAX_CHARS = 2_000
const ISSUE_LOG_MAX_CHARS = 6_000

/** Values shared by the settings plugin with its shell-overlay occupant. */
export interface ApplyingUpdateOverlayInjected {
  /** Connection whose outage/recovery brackets the update. */
  connection: ConnectionHandle
  /** Initiating tab's update state; other tabs discover the runner by polling. */
  snapshot: SnapshotStore<UpdateState>
}

export type ApplyingUpdateOverlayProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings'>
  & ApplyingUpdateOverlayInjected

/** Parse the runner's untrusted HTTP payload. */
export function parseRunnerProgress(value: unknown): RunnerProgress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.updateId !== 'string' || row.updateId === '') return null
  if (!isRunnerPhase(row.phase)) return null
  if (typeof row.status !== 'string') return null
  if (!Array.isArray(row.logs) || row.logs.length > CLIENT_LOG_LIMIT) return null
  if (typeof row.logLimit !== 'number' || !Number.isInteger(row.logLimit)
    || row.logLimit <= 0 || row.logLimit > CLIENT_LOG_LIMIT) return null
  if (typeof row.issueUrl !== 'string' || !isGitHubIssueUrl(row.issueUrl)) return null
  const logs: UpdateLogLine[] = []
  for (const rawLine of row.logs) {
    if (typeof rawLine !== 'object' || rawLine === null || Array.isArray(rawLine)) return null
    const line = rawLine as Record<string, unknown>
    if (typeof line.seq !== 'number' || !Number.isSafeInteger(line.seq) || line.seq < 0) return null
    if (line.stream !== 'system' && line.stream !== 'stdout' && line.stream !== 'stderr') return null
    if (typeof line.text !== 'string' || line.text.length > CLIENT_LOG_LINE_MAX_CHARS) return null
    logs.push({ seq: line.seq, stream: line.stream, text: line.text })
  }
  if (row.error !== undefined && typeof row.error !== 'string') return null
  return {
    updateId: row.updateId,
    phase: row.phase,
    status: row.status,
    logs,
    logLimit: row.logLimit,
    issueUrl: row.issueUrl,
    ...(row.error === undefined ? {} : { error: row.error }),
  }
}

function isRunnerPhase(value: unknown): value is RunnerPhase {
  return value === 'waiting' || value === 'pulling' || value === 'building'
    || value === 'starting' || value === 'failed'
}

function isGitHubIssueUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
      && /^\/[^/]+\/[^/]+\/issues\/new$/u.test(url.pathname)
  } catch {
    return false
  }
}

function redactIssueText(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/giu, '$1<redacted>')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s]+/giu, '$1<redacted>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gu, 'C:\\Users\\<user>')
    .replace(/\/(?:Users|home)\/[^/\s]+/gu, '/home/<user>')
    .replace(/```/gu, '` ` `')
}

/**
 * Build a reviewable GitHub issue draft from one failed runner status.
 * @param progress - validated failed-runner status and bounded log tail.
 * @returns prefilled GitHub issue URL, or `null` while the runner has not failed.
 */
export function githubIssueDraftUrl(progress: RunnerProgress): string | null {
  if (progress.phase !== 'failed' || !isGitHubIssueUrl(progress.issueUrl)) return null
  const error = redactIssueText(progress.error ?? progress.status).slice(0, 500)
  const renderedLogs = progress.logs
    .map(line => `[${line.stream}] ${line.text}`)
    .join('\n')
  const logs = redactIssueText(renderedLogs).slice(-ISSUE_LOG_MAX_CHARS)
  const url = new URL(progress.issueUrl)
  url.searchParams.set('title', `Self-update failed: ${error.slice(0, 100)}`)
  url.searchParams.set('body', [
    '## Self-update failure',
    '',
    `Update id: ${progress.updateId}`,
    `Error: ${error}`,
    '',
    '### Update log (bounded and automatically redacted)',
    '',
    '```text',
    logs,
    '```',
    '',
    '> Review the prefilled logs for private information before submitting this public issue.',
  ].join('\n'))
  return url.href
}

/**
 * Add one cache-busting navigation marker while preserving the page path,
 * query, and fragment.
 * @param href - current absolute page URL.
 * @param updateId - runner identity, or a native-relaunch timestamp.
 * @returns absolute hard-refresh URL.
 */
export function updateRefreshUrl(href: string, updateId: string): string {
  const url = new URL(href)
  url.searchParams.set(UPDATE_REFRESH_PARAM, updateId)
  return url.href
}

/** Remove the one-shot marker after the refreshed page has loaded. */
export function clearUpdateRefreshMarker(): void {
  const url = new URL(location.href)
  if (!url.searchParams.has(UPDATE_REFRESH_PARAM)) return
  url.searchParams.delete(UPDATE_REFRESH_PARAM)
  history.replaceState(history.state, '', url)
}

function phaseKey(phase: RunnerPhase | undefined): SettingsKey {
  switch (phase) {
    case 'waiting': return 'update.waiting'
    case 'pulling': return 'update.pulling'
    case 'building': return 'update.building'
    case 'starting': return 'update.starting'
    case 'failed': return 'update.failed'
    default: return 'update.preparing'
  }
}

/** Full-screen updater shown above the ordinary connection-loss surface. */
export function ApplyingUpdateOverlay({ connection, snapshot, t }: ApplyingUpdateOverlayProps) {
  const update = useSyncExternalStore(
    listener => snapshot.subscribe(listener),
    () => snapshot.getSnapshot(),
  )
  const connectionState = useSyncExternalStore(
    listener => connection.state.subscribe(listener),
    () => connection.state.getSnapshot(),
  )
  const locallyActive = update.phase === 'applying' || update.phase === 'restarting'
  const [remote, setRemote] = useState<RunnerProgress | null>(null)
  const sawOutage = useRef(false)
  const refreshStarted = useRef(false)
  const logViewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!locallyActive && connectionState !== 'reconnecting' && remote === null) return
    let disposed = false
    const poll = (): void => {
      void fetch(UPDATE_STATUS_PATH, { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) return
        const parsed = parseRunnerProgress(await response.json())
        if (!disposed && parsed !== null) setRemote(parsed)
      }).catch(() => undefined)
    }
    poll()
    const timer = window.setInterval(poll, UPDATE_POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [connectionState, locallyActive, remote])

  useEffect(() => {
    if (connectionState === 'reconnecting' && (locallyActive || remote !== null)) {
      sawOutage.current = true
      return
    }
    if (connectionState !== 'connected' || !sawOutage.current || refreshStarted.current) return
    if (remote?.phase === 'failed') return
    refreshStarted.current = true
    location.replace(updateRefreshUrl(location.href, remote?.updateId ?? String(Date.now())))
  }, [connectionState, locallyActive, remote])

  useEffect(() => {
    const viewport = logViewport.current
    if (viewport === null) return
    viewport.scrollTop = viewport.scrollHeight
  }, [remote?.logs.length])

  if (!locallyActive && remote === null) return null
  const failed = remote?.phase === 'failed'
  const lines = remote?.logs ?? [{ seq: 0, stream: 'system' as const, text: t('update.preparing') }]
  const issueDraft = remote === null ? null : githubIssueDraftUrl(remote)
  return createPortal((
    <div className={css.overlay} role="status" aria-live="polite" data-applying-update="">
      <div className={css.card}>
        <div className={css.wordmark}>HARNESS</div>
        <div className={css.title}>{t(failed ? 'update.failedTitle' : 'update.title')}</div>
        <div className={css.terminalFrame} data-failed={failed || undefined}>
          <div className={css.terminalHeader}>
            <span>{t('update.logs')}</span>
            <span>{t('update.logs.limit', { limit: String(remote?.logLimit ?? 1) })}</span>
          </div>
          <div className={css.terminal} role="log" aria-label={t('update.logs')} ref={logViewport}>
            {lines.map(line => (
              <div className={css.logLine} data-stream={line.stream} key={line.seq}>
                <span className={css.prompt} aria-hidden="true">{line.stream === 'system' ? '›' : line.stream === 'stderr' ? '!' : '$'}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={css.hint}>{t(phaseKey(remote?.phase))}</div>
        {failed && remote.error !== undefined && <div className={css.error} role="alert">{remote.error}</div>}
        {issueDraft !== null && (
          <div className={css.issueActions}>
            <a className={css.issueButton} href={issueDraft} target="_blank" rel="noreferrer">
              {t('update.issue')}
            </a>
            <span>{t('update.issue.review')}</span>
          </div>
        )}
      </div>
    </div>
  ), document.body)
}
