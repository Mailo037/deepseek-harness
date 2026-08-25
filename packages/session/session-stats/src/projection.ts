/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * chunks, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * The wall-time folds mirror the client window fold field by field
 * (`deriveStats` in dsh-client-ui-conversation, that fold's whole-window
 * fallback role): model time is `step/start` → `assistant/message`, first
 * token is the first non-empty delta chunk and survives an in-step
 * `llm/retry`, decode spans first token → assembled message on steps that
 * also report output tokens, and tool time pairs `tool/call` → `tool/result`
 * by callId. A cancelled step assembles no message, so its partial stream
 * time stays uncounted in every time figure — matching the window, which
 * renders it as an untimed interrupted node.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  /** Distinct turns with at least one closed step so far. */
  turns: number
  /** Closed steps so far. */
  steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
  /** Distinct files whose result-time diff added or removed at least one line. */
  filesEdited: number
  /** Summed added lines across applied result-time diffs. */
  linesAdded: number
  /** Summed removed lines across applied result-time diffs. */
  linesRemoved: number
}

/**
 * Fold state: the totals plus the in-flight boundaries they accrue from.
 * Turn numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** The open step's boundary facts; null outside a step or after its message assembled. */
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  pendingCalls: Record<string, number>
  /** Paths already counted toward `filesEdited`, so an edit never double-counts a file. */
  editedPaths: Record<string, true>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
  filesEdited: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
}).strict()

/**
 * The fold state's shape (totals plus in-flight boundaries), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openStep: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
  }).nullable(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
  editedPaths: z.record(z.string(), z.literal(true)),
})

/**
 * Provider-reported completion tokens, guarded the way the window fold guards
 * node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the output-token count, or null when unreported or invalid.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * The content lines of one diff side, under the same terminator rule the
 * client diff counts use: empty text has zero lines, and a single trailing
 * newline is a terminator, not an extra empty line.
 * @param text - the removed or added side's text.
 * @returns the content line count.
 */
function sideLineCount(text: string): number {
  if (text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body === '' ? 0 : body.split('\n').length
}

/**
 * Combine the added and removed line totals of a result-time metadata diff
 * array onto running counters, deduplicating edited paths in first-seen order.
 * `meta` is opaque tool-private JSON carried by the durable `tool/result`
 * event; each entry is validated against the `dsh-tool-fs` `diffs` shape
 * (`{ path, oldText|null, newText }`) before its counts can contribute.
 * @param meta - the `tool/result.data.meta` payload (unknown JsonValue).
 * @param editedPaths - paths already counted as edited.
 * @param counters - the run of per-file added/removed counters to fold into.
 * @returns whether anything was folded (a new distinct path or nonzero line change).
 */
function foldMetaDiffs(
  meta: unknown,
  editedPaths: Record<string, true>,
  counters: { added: number; removed: number },
): boolean {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return false
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return false
  let changed = false
  for (const raw of diffs) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const diff = raw as Record<string, unknown>
    const path = diff.path
    const oldText = diff.oldText
    const newText = diff.newText
    if (typeof path !== 'string'
      || (oldText !== null && typeof oldText !== 'string')
      || typeof newText !== 'string') continue
    const added = sideLineCount(newText)
    const removed = oldText === null ? 0 : sideLineCount(oldText)
    if (added === 0 && removed === 0) continue
    counters.added += added
    counters.removed += removed
    if (editedPaths[path] === undefined) editedPaths[path] = true
    changed = true
  }
  return changed
}

/** The `sessionStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const sessionStatsProjectionDefinition = {
  key: 'sessionStats',
  stateVersion: 2,
  stateSchema: sessionStatsStateSchema,
  init: () => ({
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    filesEdited: 0,
    linesAdded: 0,
    linesRemoved: 0,
    lastTurn: null,
    openStep: null,
    pendingCalls: {},
    editedPaths: {},
  }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'step/start':
        return {
          ...state,
          openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null },
        }
      case 'assistant/chunk': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) return state
        return { ...state, openStep: { ...open, firstTokenTime: event.time } }
      }
      case 'assistant/message': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        // One assembled message per step: closing the boundary means a
        // defensive duplicate cannot accrue twice.
        const next: SessionStatsState = {
          ...state,
          llmMs: state.llmMs + Math.max(0, event.time - open.startTime),
          openStep: null,
        }
        if (open.firstTokenTime !== null) {
          next.ttftMs += Math.max(0, open.firstTokenTime - open.startTime)
          next.ttftSteps += 1
          const outputTokens = usageOutputTokens(event.data.usage)
          if (outputTokens !== null) {
            next.decodeMs += Math.max(0, event.time - open.firstTokenTime)
            next.decodeTokens += outputTokens
          }
        }
        return next
      }
      case 'tool/call':
        return { ...state, pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.time } }
      case 'tool/result': {
        // Own-key check: callId is provider-minted (model/tool JSON boundary),
        // so a prototype property name ('constructor', 'toString') on a result
        // with no recorded call must read as unmatched, not as an inherited
        // function that would poison toolMs with NaN.
        const callId = event.data.message.source.callId
        const dispatched = Object.hasOwn(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
        if (dispatched === undefined) return state
        const pendingCalls = Object.fromEntries(
          Object.entries(state.pendingCalls).filter(([id]) => id !== callId),
        )
        const next: SessionStatsState = {
          ...state,
          toolMs: state.toolMs + Math.max(0, event.time - dispatched),
          pendingCalls,
        }
        // A file-mutation tool rides result-time diffs on `meta` (the durable
        // applied change); count them whole-log so paging cannot hide them.
        const counters = { added: 0, removed: 0 }
        const editedPaths = { ...next.editedPaths }
        if (foldMetaDiffs(event.data.meta, editedPaths, counters)) {
          next.linesAdded += counters.added
          next.linesRemoved += counters.removed
          next.filesEdited = Object.keys(editedPaths).length
          next.editedPaths = editedPaths
        }
        return next
      }
      case 'step/end':
        return {
          ...state,
          turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
          steps: state.steps + 1,
          lastTurn: event.data.turn,
          openStep: null,
        }
      case 'turn/end':
        // A call whose result never landed belongs to a cancelled or failed
        // turn; results always land within their turn, so drop the leftovers
        // instead of growing persisted state forever.
        return Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }
      default:
        return state
    }
  },
  wire: {
    viewSchema: sessionStatsSchema,
    view: state => ({
      turns: state.turns,
      steps: state.steps,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      ttftMs: state.ttftMs,
      ttftSteps: state.ttftSteps,
      decodeMs: state.decodeMs,
      decodeTokens: state.decodeTokens,
      filesEdited: state.filesEdited,
      linesAdded: state.linesAdded,
      linesRemoved: state.linesRemoved,
    }),
  },
} satisfies ProjectionDefinition<'sessionStats', SessionStatsState>
