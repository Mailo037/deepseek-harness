/** Watcher derivation: one event per session transition, priority
 * error > attention > done, baseline seeding, subagent silence. */
import { describe, expect, it } from 'vitest'
import type {
  JobView, SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import { listEvents, sessionEvent } from '../src/client/watcher.ts'

type Facts = Parameters<typeof sessionEvent>[0]

const facts = (over: Partial<NonNullable<Facts>> = {}): NonNullable<Facts> => ({
  running: false,
  ...over,
})

function row(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...over,
  }
}

function state(rows: Record<string, SessionSummary>, jobs: SessionListState['jobsBySession'] = {}) {
  return {
    ids: Object.keys(rows) as SessionId[],
    byId: rows as unknown as SessionListState['byId'],
    current: undefined,
    phase: 'ready' as const,
    subagentsByParent: {},
    jobsBySession: jobs,
    currentAddress: undefined,
  }
}

describe('sessionEvent', () => {
  it('never fires for an unobserved row (baseline seeding)', () => {
    expect(sessionEvent(undefined, undefined, facts({ running: true }), undefined)).toBeUndefined()
    expect(sessionEvent(undefined, undefined, facts(), undefined)).toBeUndefined()
  })

  it('fires error when attention first appears', () => {
    expect(sessionEvent(facts({ running: true }), undefined, facts({ attention: 'error' }), undefined))
      .toBe('error')
    // A stable attention never replays.
    expect(sessionEvent(facts({ attention: 'retry-exhausted' }), undefined, facts({ attention: 'retry-exhausted' }), undefined))
      .toBeUndefined()
  })

  it('fires attention when an interaction starts blocking', () => {
    expect(sessionEvent(facts({ running: true }), undefined, facts({ pendingInteraction: 'approval' }), undefined))
      .toBe('attention')
  })

  it('fires done when a run stops without follow-up needs', () => {
    expect(sessionEvent(facts({ running: true }), undefined, facts(), undefined)).toBe('done')
    // Stopping into attention/interaction names those instead.
    expect(sessionEvent(facts({ running: true }), undefined, facts({ attention: 'error' }), undefined))
      .toBe('error')
    // Idle → idle is nothing.
    expect(sessionEvent(facts(), undefined, facts(), undefined)).toBeUndefined()
  })

  it('fires done for the first completed background job on an idle row', () => {
    const job = { status: 'completed' } as JobView
    const runningJob = { status: 'running' } as JobView
    expect(sessionEvent(facts(), [runningJob], facts(), [job])).toBe('done')
    // Already-completed stays silent; completion while still running waits.
    expect(sessionEvent(facts(), [job], facts(), [job])).toBeUndefined()
    expect(sessionEvent(facts({ running: true }), [], facts({ running: true }), [job])).toBeUndefined()
  })
})

describe('listEvents', () => {
  it('derives per-row events in list order and skips subagent rows', () => {
    const prev = state({
      a: row('a', { running: true }),
      b: row('b'),
      s: row('s', { origin: 'subagent', parentId: 'a' as SessionId }),
      c: row('c'),
    })
    const next = state({
      a: row('a', { completed: true }),
      b: row('b', { attention: 'error' }),
      s: row('s', { origin: 'subagent' }),
      c: row('c', { pendingInteraction: 'question' }),
    })
    expect(listEvents(prev, next)).toEqual([
      { sessionId: 'a', kind: 'done' },
      { sessionId: 'b', kind: 'error' },
      { sessionId: 'c', kind: 'attention' },
    ])
  })

  it('seeds the whole baseline when nothing was observed before', () => {
    expect(listEvents(undefined, state({ a: row('a', { attention: 'error' }) }))).toEqual([])
  })
})
