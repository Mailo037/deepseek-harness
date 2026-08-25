# Agent Note: Turn-error retry delivers the continue prompt ahead of queued messages

Status: implemented

English | [中文](2026-08-25-turn-error-retry-prepends-to-queue.zh.md)

## Problem

The turn-error "Retry" button sends the localized continue message ("An unexpected error occurred, please continue what you were doing.") through `conversation.send()` → `session.prompt(mode: 'queue')` → `agent.followup()`, which **appends** the continue prompt to the *back* of the next-turn queue. When the user has already queued messages (typed while the failed turn was running), the topmost queued message becomes the next turn instead of the retry continue prompt.

The retry was designed to "queue behind it" (see the original agent note 2026-08-14-turn-error-inline-retry-copy), but this defeats the user's expectation: pressing Retry should cause the continue prompt to be delivered immediately — not their previously queued messages.

## Decision

Add a `prepend` delivery mode end-to-end so the retry continue prompt is inserted at the **front** of the next-turn queue, ahead of any already-queued messages.

### Agent interface (`packages/core/agent`)

A new public method `Agent.prepend(message)` was added to the `Agent` interface and implemented in `ReactLoopAgent`. It mirrors `followup` but uses `Inbox.prepend('next-turn', input)` instead of appending, and wakes the driver with the same wake-classification logic.

### Host API (`packages/host/apiproxy`)

The `sessions.prompt` RPC accepts a third mode `'prepend'` alongside `'queue'` and `'steer'`. The handler dispatches `agent.prepend(message)` when the mode is `'prepend'`.

### Client runtime (`packages/client/runtime`)

The `ISession.prompt` mode union widened to `'queue' | 'prepend' | 'steer'`. The concrete `Session.prompt` passes through the mode verbatim.

### UI conversation (`packages/client/ui-conversation`)

- `IConversation.send` gained an optional `mode` parameter (default `'queue'`), so the retry wiring can request `'prepend'`.
- The turn-error `sendMessage` inject in `apply.ts` calls `scoped.send(text, 'prepend')` — the continue prompt is now delivered to the front of the queue.
- Slot contract JSDoc updated to reflect the immediate-next-turn semantics.

### Semantics

- **Idle driver with parked queue** (the typical scenario after a failed turn): the retry message becomes the very next turn; queued messages follow in order.
- **Running driver**: the retry message sits at the front of the next-turn queue, so it runs after the current turn finishes but before any previously queued turns.
- **Empty queue**: behaves identically to `followup` (starts one turn).

## Alternatives considered

**Client-side two-step (prompt + updateQueue move).** The client would send the prompt (queue mode) then immediately move the row to index 0 via `updateQueue`. This is racy: the host driver may start the next queued turn before the move RPC arrives, causing the move to fail with `queue-item-not-found`. Rejected.

**Steer mode.** Steer delivers to the `next-step` inbox, which is claimed together with the first `next-turn` item in the same turn step. With queued messages, the retry message and the first queued message would enter the same turn — not what the user expects. Rejected.

## Consequences

- The retry button now reliably sends the continue prompt as the immediate next turn, regardless of queued messages.
- The wire protocol grows a new mode value (`'prepend'`). The host schema, client contract, and agent interface all widen their union types. Handlers not updated for `'prepend'` will reject it at the schema validation layer (Zod) or the agent interface (TypeScript).
- The `cordis-client-runner` api-catalog and `tool-cordis` api-catalog should be regenerated after merging (`pnpm run gen-cordis-api` and `pnpm run gen-cordis-inspect-catalog`) to bring the generated ISession declaration in sync with the widened mode union.
- The `chat-view` component test for the retry gesture still passes: the callback receives the localized continue message unchanged; only the delivery mode differs.