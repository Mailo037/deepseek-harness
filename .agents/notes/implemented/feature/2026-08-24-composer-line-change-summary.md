# Agent Note: Composer line-change summary

Status: implemented

English | [中文](2026-08-24-composer-line-change-summary.zh.md)

## Problem

Each mutation tool row exposes its own added and removed line totals, but a reader cannot see the task's cumulative file impact without opening and adding every row.

## Decision

`@deepseek-ai/dsh-client-ui-deliverables` records successful result-time diff hunks as `DeliverablesTurnData.lineChanges` beside its existing produced paths. The Composer-side `LineChangeSummary` reads the assembled Chat timeline, keeps the first path position, and adds later hunks for the same path. Its centered `conversation.input.dock` trigger shows the changed-file count and green `+` / red `-` totals; when open, its chevron turns upward and the bounded scrolling dialog presents each filename, a middle dot, the full path, and that path's totals. Escape and outside pointer input close the dialog.

Call-time diff intents and generic `edit` locations do not enter the summary. Result-time diff hunks are the applied presentation data, while the other two forms cannot promise exact line counts. The summary remains a browser-only projection: it adds neither a Session event nor a Host projection, request, or model-visible input. The whole-session tally across paged history — distinct files and added/removed line totals — is served separately by the durable `sessionStats` projection and the chat stats strip, not this disclosure ([durable session file-edit stats](2026-08-25-durable-session-file-edit-stats.md)).

## Alternatives considered

**Add counts from pending call views.** A call view can describe an intended overwrite rather than the applied contextual change, so its totals can disagree with the settled DiffBlock.

**Put the disclosure inside the Composer tool row.** File impact describes completed work and needs room for a multiline path list; the input dock gives it one stable, centered line without competing with send controls.

**Publish a whole-log Host projection.** The existing Deliverables data and Chat timeline already answer the visible browser view. A durable projection would add a second owner and an exact-history promise beyond this UI request.

## Consequences

The turn-tail file chips, final-response links, and Composer summary continue to share one Deliverables feature boundary. The summary only represents result-time diffs in the timeline the browser has assembled; generic edit locations and unloaded history remain absent rather than receiving invented totals. `produced-files.client.spec.tsx` verifies result-diff accumulation, repeated-path grouping, disclosure behavior, and registration disposal; `apps/web/tests/produced-files.e2e.ts` replays the assembled Web session and its accessible disclosure.
