# Agent Note: Running-session composer primary and duplicate turn fold

Status: implemented

English | [中文](2026-08-21-running-composer-and-turn-fold.zh.md)

## Problem

Two assembled-chat defects from live use. First, a closed turn whose node list was split by a session-scoped row — typically an admitted mid-turn steer — rendered two identical "Ran for …" duration folds (duplicate React keys included), one above and one below the answer's controls. Second, while a session was running the composer's primary button was hard-wired to Stop, so the pointer-only path for queuing a typed follow-up did not exist; only the Enter gesture reached the queue.

## Decision

- **One fold per turn** (`ui-conversation` ChatView): flow construction now segments the node order by consecutive equal closed turns first and makes the fold decision read the whole turn — the ≥10-action threshold sums every segment of that turn, all foldable elements collect into one body per turn, and a placeholder slot at the turn's first fold resolves into the single summary after the walk.
- **A non-empty draft outranks Stop** (`ui-conversation` InputBar): during a running ordinary session, a draft with content flips the primary button back to Send; clicking it submits through the same queue-mode resolution as the running-state Enter gesture (queue, or steer when the busy-state preference says so). With an empty draft the primary remains Stop. A queued message loaded for editing still shows Save, and continuable children keep Send-primary beside their independent Stop.

## Alternatives considered

- **Merge across the gap in the chunker** (treat an undefined-turn node between two equal closed turns as part of the turn): lost because the interleaved row must stay in flow at its own position, and widening the chunker would also absorb genuinely session-scoped rows into the fold body.
- **Keep Stop and add a second Send button while running**: lost because two adjacent primaries compete for the same gesture slot; the draft's presence is already an unambiguous signal of intent.

## Consequences

The turn-summary React key is unique again, and folded work of a split turn renders inside its turn's single disclosure regardless of where the steering row sits. During a run, stopping now requires an empty draft (clear it, or let a queued edit finish) — accepted because typing is itself the intent signal and the empty-draft state restores Stop immediately. Compositions whose submit face lacks queue support keep the previous shape: without a running turn nothing changes.

## Testing

`packages/client/ui-conversation/tests/chat-view.client.spec.tsx` pins the single-fold rendering for a steer-split folded turn; `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` pins the Send flip with a non-empty draft, the queue dispatch on click, and the empty-draft Stop retention.
