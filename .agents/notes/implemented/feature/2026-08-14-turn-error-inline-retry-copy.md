# Agent Note: Turn-error inline retry and copy actions

Status: implemented

English | [中文](2026-08-14-turn-error-inline-retry-copy.zh.md)

## Problem

A terminal turn failure rendered as a static status row ("This turn failed" plus the display-safe message and optional code). The only way forward was manual: the reader had to compose a continuation prompt themselves, and copying the failure message for a bug report meant hand-selecting text out of the transcript row.

## Decision

The `turn-error` chat node renders an inline action strip under its status row: a **Retry** button and the shared copy IconActions for the error message.

- Retry sends one queued user turn whose prompt is the localized continue message (`message.turnError.retryMessage`: "An unexpected error occurred, please continue what you were doing." / "发生意外错误，请继续你之前的工作。"). It rides the ordinary send path — `conversation.send` on the session scope — so the sent prompt is a durable, visible user message and every later turn sees it ([model-visible ⟺ logged](../../../docs/architecture.md)).
- Copy reuses `MessageIconActions` with the error's display-safe message as copy text; it inherits the established copied/check-swap chrome.
- The callback reaches the renderer through the slot system, not a service import: `ChatNodeOwnerProps` gains `sendMessage(text)`, supplied by the chat view entry's inject from `scopedConversation(...).send(...)`. A rejected admission lands in the snapshot's `promptError`; the inject swallows the rejection because nothing on the caller side can recover it.
- The buttons sit outside the `role="status"` element, so screen readers still announce exactly the failure text.
- Every historical turn error shows the strip, not only the latest one; retrying while another turn runs simply queues behind it (the send path's queue mode).

Context: the failure itself and its AUTH sanitization are owned by [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.md); this note only adds presentation-layer affordances on top of that node.

## Alternatives considered

**Draft injection via `inputActions.setDraft` + `submit()`** — rejected: submit consumes whatever draft the user has typed, so a retry click could silently destroy an in-progress composition. The conversation-service send path leaves the draft untouched.

**An invisible model-visible nudge** (sending without a transcript record) — rejected: repo-wide rule, anything reaching a model request must be reconstructable from the session log; a hidden input would require a new session event and would mislead later readers about why the turn continued.

**Retry only on the latest turn error / disable while running** — rejected for now: the queue semantics already make a mid-run click harmless, and gating on "latest" would couple the renderer to timeline state it does not otherwise read. Revisit if accidental clicks on old errors become real.

## Consequences

The chat-node owner currency grew one required member (`sendMessage`), which every keyed renderer prop literal must supply; the generated client slot catalog tracks the contract source and is regenerated in the same change. The continue prompt is localized UI copy that enters the model's context, so its wording is pinned by the locale dictionaries rather than left to the model. Component coverage pins the retry gesture (callback receives the localized continue message) and the per-block copy action in `chat-view.client.spec.tsx`.
