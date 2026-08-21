# Agent Note: Composer-side queue editing and drag reorder

Status: implemented

English | [中文](2026-08-21-composer-side-queue-edit-and-reorder.zh.md)

## Problem

The queue dock edited pending rows in a cramped inline one-line input and offered no way to change the order in which queued messages are sent. The inline editor duplicated composer concerns (IME composition guards, undo history) in a second, impoverished surface, and editing a row threw away whatever the user had been drafting in the composer.

## Decision

Reordering and editing are two new verbs over the same authoritative queue snapshot:

- **Wire**: `QueueAction` gains `{ kind: 'move'; toIndex: number }`. The Host handler accepts moves against `next-turn` rows only (steering/context rows answer `queue-item-not-found`) and clamps `toIndex` into the current list, so a claim race between snapshot and drop degrades to a nearest-position commit instead of an error.
- **Inbox**: `Inbox.move(messageId, toIndex)` repositions one pending next-turn message as exactly one durable window splice covering `[min(from,to), max(from,to)]`, reordered inside. The mutation is silent — no `outcome: 'canceled'`, no discarded/inserted notifications — because nothing entered or left the queue. Identities survive; replay reconstructs through the existing generic splice application.
- **Dock**: once two ordinary-session rows exist, each row carries a far-left grip. Dragging it onto another row (HTML5 dnd) or pressing ArrowUp/ArrowDown on the focused grip commits one `move`; the drop indicator is presentation-only and the authoritative snapshot redraws the order. There is still no optimistic client mutation.
- **Composer edit**: the dock's edit verb hands the row to the per-session input shell. The shell stashes the current draft plus attached image ids (descriptors stay alive), replaces the draft with the row's text, and publishes `InputState.queueEdit`. Submitting while an edit is loaded bypasses slash adjudication entirely and sends one text `edit` action against that occurrence — which keeps its queue position — then restores the stash. Escape, the banner button, and the dock's per-row cancel all restore without mutating the queue. A whitespace-only submit is a no-op like the machine's empty-draft guard. If the edited occurrence leaves the pending queue mid-edit, the stash restores automatically so the race cannot swallow the user's own draft; a rejected edit keeps the edit open with a localized notice while the row still pends. The whole-queue accelerated-Enter steer gesture is suppressed while an edit is loaded.

## Alternatives considered

- **Optimistic client-side reorder** — rejected: it would break the queue projection's settled rule that the next Host snapshot is the sole visible commit, and a rejected move would need rollback logic the authority already provides for free.
- **Move as remove-plus-insert splices** — rejected: two durable events where one suffices, the removal would carry the cancellation outcome and fire discarded notifications, and the inter-event window misrepresents a live reorder as a cancellation.
- **Keep the inline editor and add reorder handles beside it** — rejected: the inline input reimplements a slice of the composer (IME guards, undo, caret handling) at a fraction of the quality, and the product direction was to edit in the composer itself.
- **Emit `agent/inbox/inserted` for the moved message only** — rejected: consumers such as the goal-round-driver read inserted next-turn messages as newly competing queued work; a pure reorder must not look like new competition, so the silent mode is the honest signal.

## Consequences

A reorder costs exactly one durable event at any distance, and synchronous observers see one atomic position change. The edit stash lives only inside the session input shell and is never published, so it survives session switches (each shell owns its own) but not page reloads — the same durability the unsubmitted draft always had. The queue-actions browser scenario now exercises composer-side editing and a drag reorder; its `editing` and `preserved` aria goldens describe the new surfaces and were refreshed with that run.
