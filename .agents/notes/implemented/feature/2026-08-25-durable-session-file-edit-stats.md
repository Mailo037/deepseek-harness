# Agent Note: Durable session file-edit stats

Status: implemented

English | [中文](2026-08-25-durable-session-file-edit-stats.zh.md)

## Problem

The chat stats strip previously showed token, wall-time, and count figures, but no file-impact totals that survive history paging. The turn-scoped [composer line-change summary](2026-08-24-composer-line-change-summary.md) covers the loaded browser window only, and its decision deliberately rejected a whole-log Host projection "beyond this UI request" — so a reader who has not loaded the whole chat could not see how many files and lines the session edited.

## Decision

`@deepseek-ai/dsh-session-stats` folds file-edit totals into the existing whole-log `sessionStats` projection. Its `tool/result` handling now also reads the result-time diffs a mutation tool attaches to `event.data.meta` (`dsh-tool-fs` writes `{ diffs: [{ path, oldText, newText }] }`) and publishes three new view fields — `filesEdited`, `linesAdded`, `linesRemoved` — deduplicating paths across the whole log and counting lines under the same terminator rule as the client diff card. Only results paired with a recorded `tool/call` contribute, matching the existing `toolMs` rule, so a crash-recovery result with no call counts nothing. The persisted-cache state now also keeps a `editedPaths` record; the unit's `stateVersion` rises to 2.

The composer stats strip (`StatsLine`) appends a file-edit group — localized as `{files} files · +{linesAdded} · -{linesRemoved}` (Chinese `{files} 个文件 · +{linesAdded} · -{linesRemoved}`) — whenever the projection serves a positive `filesEdited`. Because the strip already reads the durable `sessionStats` projection through `useProjection`, the group survives paging and compaction exactly like the existing count and token groups; the no-unit window fallback (`deriveStats`) does not compute edits, so an assembly without the projection never fabricates a count.

## Alternatives considered

**Compute the totals client-side from the loaded window.** A window fold would recount per loaded page and hide any file edited outside the loaded suffix — the same paging hazard the projection exists to remove. The durable projection is the only reading that answers "how many files/lines in this session" from the first tail page.

**Add edits to the turn-scoped `LineChangeSummary` disclosure instead.** That dialog reports the visible window's per-path detail; the request here is a whole-session tally in the stats strip. Both surfaces keep the same `dsh-tool-fs` diff vocabulary, but the footer's one line is the durable-aggregate home and the disclosure stays the browsable detail.

## Consequences

The stats strip now reports whole-session file impact without loading history, satisfying the "global tracker" request. A new small set of keys rides every web tail page and list row (`filesEdited`, `linesAdded`, `linesRemoved`), and the unit's state changes on each paired `tool/result`, so the change feed emits a few extra frames. Sessions with no file edits show no group (nothing misleading renders). The [composer line-change summary](2026-08-24-composer-line-change-summary.md) is unchanged: its turn-scoped, browser-only browser disclosure remains the detail view, now complemented by the durable whole-session footer totals. Projection unit tests pin the distinct-file dedup, line totals, create-vs-edit handling, and the pair-required rule; the stats-strip spec pins the group rendering and its zero-hide.
