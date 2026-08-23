/**
 * Pure transition derivation over the sessions list snapshot — the same
 * `SessionSummary` facts the workspace browser's status dots project
 * (`running`, `attention`, `pendingInteraction`, plus completed background
 * jobs). A transition fires only against the previously observed snapshot, so
 * a fresh baseline (boot, reconnect re-pull) never announces retroactively.
 */
import type {
  JobView, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One playable notification event. */
export type NotificationEventKind = 'done' | 'attention' | 'error'

/** One derived event with the session it belongs to. */
export interface NotificationEvent {
  sessionId: SessionId
  kind: NotificationEventKind
}

function hasCompletedJob(jobs: readonly JobView[] | undefined): boolean {
  return jobs?.some(job => job.status === 'completed') === true
}

/**
 * Derive at most one event for one session row between two snapshots.
 * Priority is error > attention > done: when several facts move in one
 * flush, the most urgent dot state names the sound.
 * @param prev - the session's previous summary, undefined for rows that were not observed before.
 * @param prevJobs - previous background jobs of the session.
 * @param next - current summary.
 * @param nextJobs - current background jobs of the session.
 * @returns the event kind, or undefined when nothing notable moved.
 */
export function sessionEvent(
  prev:
    | {
      running: boolean
      attention?: 'retry-exhausted' | 'error'
      pendingInteraction?: unknown
    }
    | undefined,
  prevJobs: readonly JobView[] | undefined,
  next: { running: boolean; attention?: 'retry-exhausted' | 'error'; pendingInteraction?: unknown },
  nextJobs: readonly JobView[] | undefined,
): NotificationEventKind | undefined {
  if (prev === undefined) return undefined
  if (prev.attention === undefined && next.attention !== undefined) return 'error'
  if (prev.pendingInteraction === undefined && next.pendingInteraction !== undefined) return 'attention'
  if (next.attention !== undefined || next.pendingInteraction !== undefined) return undefined
  if (prev.running && !next.running) return 'done'
  // Background job settled on an idle row (the green reminder dot's other
  // source): announce only the first completed job, never mid-run noise.
  if (!prev.running && !hasCompletedJob(prevJobs) && hasCompletedJob(nextJobs)) return 'done'
  return undefined
}

/**
 * Derive the events for a whole list transition. Subagent-origin rows stay
 * silent (their lifecycle surfaces through the parent's background activity);
 * unobserved rows only seed the baseline.
 * @param prev - previously observed list snapshot, undefined before the first observation.
 * @param next - current list snapshot.
 * @returns the events in list order.
 */
export function listEvents(
  prev: SessionListState | undefined,
  next: Pick<SessionListState, 'byId' | 'jobsBySession'>,
): NotificationEvent[] {
  const events: NotificationEvent[] = []
  for (const summary of Object.values(next.byId)) {
    if (summary.origin === 'subagent') continue
    const kind = sessionEvent(
      prev?.byId[summary.id],
      prev?.jobsBySession[summary.id],
      summary,
      next.jobsBySession[summary.id],
    )
    if (kind !== undefined) events.push({ sessionId: summary.id, kind })
  }
  return events
}
