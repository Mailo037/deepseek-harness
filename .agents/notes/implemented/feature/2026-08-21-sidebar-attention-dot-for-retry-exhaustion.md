# Agent Note: Sidebar attention dot for retry-exhausted sessions

Status: implemented

English | [中文](2026-08-21-sidebar-attention-dot-for-retry-exhaustion.zh.md)

## Problem

When a session's model-request retry budget is exhausted (the "5/5 retries failed" case), the sidebar shows the green "done" or "idle" dot — the same visual as a successfully completed session. The user cannot tell from the sidebar that the AI's last turn failed after exhausting every retry, so they may not notice the failure until they open the conversation.

## Decision

The host's `session.list` summary and `host/session-status` live frame carry a new `attention` field (`'retry-exhausted' | null`). The sidebar shows a red **error** dot with the "Needs attention" label whenever the latest turn ended in a terminal error after exhausting its retry budget, replacing the green "done" or "idle" dot.

### Host-side derivation

The `sessionListMetadata` projection unit — the persisted hint already used by `session.list` — gained a new `attention?: 'retry-exhausted'` field. The fold `applySessionListMetadata` tracks an internal `exhaustedRetryTurn` counter: when an `llm/retry` event arrives with `retry === maxRetries` (mode `normal`), the turn is marked as having exhausted its budget. On `turn/end` with `reason.kind === 'error'` and matching turn, the fold sets `attention = 'retry-exhausted'`. An `assistant/message` event clears the tracking (the retry attempt recovered), as does a `turn/start` (a fresh turn supersedes the previous verdict). The `view` function strips the internal tracker, publishing only the clean public hint. `stateVersion` bumped from 1 to 2 to discard stale cached rows.

Both `summarize()` (attached sessions) and `summarizeCold()` (projection-cache-backed cold sessions) include `attention` in their returned `SessionSummary`. The `agent/status` handler also computes the fold at frame time and includes `attention` in the `host/session-status` frame with a required `null` when absent (so the client can both set and clear the verdict from the live channel).

### Wire contract changes

- `SessionSummary` gains `attention?: 'retry-exhausted'` — the session.list row carries the verdict for the live and cold paths.
- `HostFrame['host/session-status']` gains required `attention: 'retry-exhausted' | null` — every status flip carries the authoritative verdict.
- `SessionListMetadata` gains `attention?: 'retry-exhausted'` — the persisted projection hint carries it for cold sessions.

### Client-side propagation

The host wire field flows through `SessionManager.applyMutation` (status and upsert mutations), `SessionListEntry`, the client `SessionSummary` in `projectList`, `SessionNode`/`SearchResultNode` in `tree.ts`, and finally `sessionStatuses()` in `Rows.tsx`. The status function returns `[{state: 'error', label: '需要关注' / 'Needs attention'}]` before checking `completed` or falling back to `idle`, so the red dot replaces the green one whenever the verdict is set. The commitment reminder (completion notification) is still armed on running→idle edges but is visually overridden by the attention verdict.

## Alternatives considered

### Client-side derivation from the event log

The client could compute the retry-exhausted verdict from the session's event window. Rejected because the sidebar must show the correct dot for unviewed sessions that have no in-memory Session instance (and therefore no event window). The summary is the only data source for those rows.

### Re-pull the session list on every running→idle transition

Instead of extending the `host/session-status` frame with attention, the client could re-pull `session.list` when a session stops running. Rejected: the host frame is the established live channel for exactly this fact, and a list re-pull is heavier (RPC round-trip, full serialization of every row). The live frame extension is explicit and zero-cost after the fold is computed.

### Amber/warning dot instead of red error

The StateDot has an amber `warning` state used for pending user interactions (approvals, questions). Reusing it for "retry exhausted" would blur the semantic boundary between "waiting for user input" and "AI failed". The red `error` state clearly communicates a failure, and the user explicitly mentioned "rot oder Orange" (red or orange). Red is the unambiguous choice.

## Consequences

- A session that failed 5/5 retries now shows a red error dot in the sidebar — the user can see the failure without opening the chat.
- The verdict persists across host restarts for cold sessions that have a projection-cache checkpoint covering the failure turn.
- After a fresh turn starts (user sends a new prompt), the attention clears automatically — the session is working again.
- The `stateVersion` bump for the `sessionListMetadata` projection invalidates existing cached rows; they are re-derived from the log on the next append, which is the sanctioned cache-upgrade mechanism and has no data-loss risk.
- The total change surface is ~400 lines across 20 files (host types, wire schema, fold logic, client runtime, tree, rows, locales, tests, and infrastructure), with every test passing.