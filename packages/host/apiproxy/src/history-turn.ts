/** Completed-turn timing for a page whose first event follows its turn/start. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { HistoryTurn } from './api/sessions.ts'

/**
 * Read the logged bounds without adding out-of-window events to a contiguous page.
 * @param events - the complete session cut used for pagination.
 * @param firstSeq - first event in the returned page.
 * @returns the cut completed turn, or undefined for a whole or running turn.
 */
export function historyHeadTurn(events: readonly SessionEvent[], firstSeq: number | undefined): HistoryTurn | undefined {
  if (firstSeq === undefined) return undefined
  let start: Extract<SessionEvent, { type: 'turn/start' }> | undefined
  let hasEarlierWork = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      if (event.seq >= firstSeq) return undefined
      start = event
      hasEarlierWork = false
    } else if (event.type === 'turn/end' && start?.data.turn === event.data.turn) {
      if (event.seq >= firstSeq) {
        return hasEarlierWork
          ? { turn: event.data.turn, startSeq: start.seq, startTime: start.time, endTime: event.time }
          : undefined
      }
      start = undefined
    } else if (event.seq < firstSeq && (event.type === 'assistant/message' || event.type === 'tool/call')) {
      hasEarlierWork = true
    }
  }
  return undefined
}
