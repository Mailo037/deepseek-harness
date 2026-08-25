# Agent Note: Think-only steps always join the tool-role group

Status: implemented

English | [中文](2026-08-24-thinking-seats-join-tool-group.zh.md)

## Problem

The conversation flow renders contiguous tool calls inside one bounded `ToolCallGroup` window (the tool-role seat), while steps carrying visible text render in flow and split the run. A Think-only step — an assistant step whose only rendered content is a reasoning row plus tool heads, with no visible text — was treated differently depending on position. It joined the surrounding run only while further tool calls kept following it; a TRAILING Think-only step (no further tool call before the next visible content) was flushed into flow instead. That split rendered the same reasoning seat inside the window or outside it depending on whether any tool call happened to come later, so a run ending in thought left the Think row in flow above the answer text instead of inside the tool window it belongs to. The tool-role composition was internally inconsistent: the Think row is part of the tool-role surface, not part of the answer text.

## Decision

In `ChatView.buildElements`, a Think-only step is now the same kind of run member as a `tool-call`, `model-retry`, or `context` node: it joins (or starts) the run unconditionally, and the run is only flushed when a non-member node arrives or the flow ends. The `trailingThink` buffer and its two flushers (`flushThinkIntoRun`, `flushTrailingThinkStandalone`) are gone; the loop has one `flushRun` call on the non-run path and one at the end. `groupHeaderOf` already names a run of Think rows alone "Think", so no header change is needed. `runIsActive` now also returns true for a member assistant step whose status is `running`, so a streaming trailing Think row keeps the window open-while-active instead of hiding behind the tucked group header while it is still updating. Interrupted steps continue to render in flow because `isThinkOnly` still returns false for them; their Stopped marker must never hide behind a work-summary fold.

## Alternatives considered

**Keep the trailing think in flow and only fix the grouping split descriptively.** This is the prior behavior, which is exactly the reported bug: the seat's placement depended on whether a later tool call happened to exist rather than on what surface the reasoning belongs to.

**Treat a trailing Think row as part of the answer text's lead.** Rejected: its only content is a reasoning disclosure with no visible words, so it shares nothing with the text step that follows and belongs to the tool-role surface.

**Leave `runIsActive` inspecting only tool calls.** Rejected: a streaming trailing Think row in a tucked group would collapse to its header while it was still animating, hiding the very activity the open-while-active behavior exists to show.

## Consequences

The tool-role window is now self-consistent: every Think-only seat renders inside the group regardless of whether a tool call follows. A lone Think-only step still renders as a bare row with no window chrome per the single-member rule, and an interrupted think still splits the run with its Stopped marker visible. A streaming trailing think now keeps its group open while it updates. Tests in `chat-view.client.spec.tsx` that pinned the old trailing-in-flow behavior were updated to assert the Think row is inside the group; the interrupted-in-flow and mixed-reasoning+text-in-flow guarantees are unchanged.
