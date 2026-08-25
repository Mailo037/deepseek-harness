# @deepseek-ai/dsh-session-stats

English | [中文](README.zh.md)

Function plugin registering the `sessionStats` projection unit: whole-log conversation figures — turn/step counts and the LLM, tool, first-token, decode, and file-edit totals — folded from step boundaries, stream chunks, tool pairs, assembled assistant messages, and the applied diffs mutation tools attach to their `tool/result` events, and served through the session-projection seam (registry snapshot, change feed, and every projection carrier: history tail page, `session/projection` push frames, session list rows). Clients render full-session figures that paging and compaction cannot change; the reference consumer is the web chat stats strip, whose window fold mirrors these field names as its no-unit fallback.

## Fold semantics

- `steps` counts `step/end` events. The agent loop appends exactly one per entered step, in a `finally`, so completed, failed, cancelled, and max-tokens steps all count. Counting assembled assistant messages instead would overcount max-tokens usage-host messages (empty content, excluded from the surface) and undercount cancelled steps (aborted before the message assembles).
- `turns` counts distinct turns carrying at least one closed step; rejected or empty turns (closed with no step) are uncounted. Turn numbers are host-assigned and monotonic per session, so the fold keeps only the last counted turn.
- `llmMs` sums `step/start` → `assistant/message` per step that assembled a message (retry waits inside the step are model time, as in the window fold).
- `ttftMs`/`ttftSteps` sum and count `step/start` → first non-empty delta chunk; the first attempt's boundary survives an in-step `llm/retry` (window `resetForRetry` parity).
- `decodeMs`/`decodeTokens` sum first token → assembled message and the provider-reported output tokens, only over steps carrying both.
- `toolMs` sums `tool/call` → `tool/result` pairs matched by callId; unresolved calls are dropped at `turn/end` (results land within their turn).
- `filesEdited`/`linesAdded`/`linesRemoved` fold the result-time diffs a mutation tool attaches to `tool/result` `meta` (`dsh-tool-fs` writes `{ diffs: [{ path, oldText, newText }] }`): files are deduplicated across the whole log, and line counts use the same terminator rule as the client diff card. Only results paired with a recorded call contribute, matching `toolMs`.
- Every field is 0 until its first contributing event. A composed registry always serves the key, so clients read the value, never key presence.

## Composition

```yaml
- id: session-stats
  name: '@deepseek-ai/dsh-session-stats'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Steps count work attempted, not visible output** — a step that failed before producing any visible content still closed with `step/end` and counts; a step interrupted by a crash counts after the session reloads, when crash recovery appends its synthetic `step/end` (`interruptedTurnClosers` in dsh-session).
- **A cancelled step is counted but untimed** — no assistant message assembles, so its partial stream time enters no wall-time figure, matching the window fold's untimed interrupted node; a max-tokens usage-host message conversely contributes model time the surface does not show.
- **Counts are log-scoped, not surface-scoped** — steps whose messages were later compacted away stay counted; the figures describe the whole session, not the current model-visible surface.
- **Mounted only in the web-app bundle** — other assemblies serve no `sessionStats` key, and their consumers fall back to window-scoped counting (the web stats strip's fallback path). The edit-total fields are not part of that window fallback: they render only when the projection is served, so a no-unit assembly never fabricates an edit count.
