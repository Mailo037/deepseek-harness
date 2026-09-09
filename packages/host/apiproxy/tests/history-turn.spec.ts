/** Page-cut turn metadata is derived from the same immutable history cut. */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { historyHeadTurn } from '../src/history-turn.ts'
import { sessionHistoryValueSchema } from '../src/api/sessions.schema.ts'
import { subagentHistoryValueSchema } from '../src/api/subagents.schema.ts'

const events: SessionEvent[] = [
  { seq: 2, time: 1_000, type: 'turn/start', data: { turn: 1 } },
  { seq: 3, time: 2_000, type: 'assistant/message', data: {
    turn: 1, step: 0,
    message: createAssistantMessage({ content: [{ type: 'text', text: 'working' }], source: { provider: 'p', model: 'm' } }),
  } },
  { seq: 8, time: 4_000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  { seq: 9, time: 5_000, type: 'turn/start', data: { turn: 2 } },
]

describe('historyHeadTurn', () => {
  it('preserves valid summaries and rejects invalid bounds through both transports', () => {
    const headTurn = { turn: 1, startSeq: 2, startTime: 1_000, endTime: 4_000 }
    for (const schema of [sessionHistoryValueSchema, subagentHistoryValueSchema]) {
      expect(schema.parse({ events: [], hasMore: true, headTurn })).toMatchObject({ headTurn })
      expect(schema.safeParse({ events: [], hasMore: true, headTurn: { ...headTurn, startSeq: -1 } }).success).toBe(false)
    }
  })

  it('returns complete timing for a cut closed turn including an end-only page', () => {
    for (const firstSeq of [4, 8]) {
      expect(historyHeadTurn(events, firstSeq)).toEqual({ turn: 1, startSeq: 2, startTime: 1_000, endTime: 4_000 })
    }
  })

  it('omits empty, whole, between-turn and running windows', () => {
    for (const firstSeq of [undefined, 0, 2, 3, 9, 10]) {
      expect(historyHeadTurn(events, firstSeq)).toBeUndefined()
    }
    expect(historyHeadTurn(events.slice(0, 3), 9)).toBeUndefined()
    expect(historyHeadTurn(events.slice(2, 3), 8)).toBeUndefined()
  })
})
