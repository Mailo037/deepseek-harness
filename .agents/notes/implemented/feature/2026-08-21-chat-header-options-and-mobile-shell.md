# Agent Note: Chat header more-options menu, mobile off-frame sidebar, and long user bubble collapse

Status: implemented

English | [中文](2026-08-21-chat-header-options-and-mobile-shell.zh.md)

## Problem

Three presentation gaps in the assembled web client: a user who pastes an over-long prompt reads an unbounded bubble that pushes the whole transcript out of view; on phone-sized frames the closed sidebar still reserves a 56px rail, and the only open affordance lives inside that rail; and the current chat's management verbs (rename, fork, move to another workspace, archive, download its log) exist either as per-row menus inside the sidebar browser or as a loose `Session log` capsule in the header, so managing the open conversation requires finding its row or aiming at a second control.

## Decision

- **Long user bubbles collapse** (`ui-conversation`): `UserStyleBubble` renders its body through `ClampableBubbleBody`, which measures the body's `scrollHeight` in a layout-synchronized effect keyed to the content array. Above 264px it clamps at 240px with a fade into the bubble fill and one localized toggle (显示更多/收起); toggling expands in place. Pending steering shares the component, so a growing pre-admission steer re-measures.
- **Mobile off-frame sidebar** (`ui-layout`): below `SIDEBAR_DRAWER_BREAKPOINT`, a closed sidebar contributes a zero-width grid track instead of the 56px rail (frame attribute `data-sidebar-offframe`; the solved center absorbs the rail width). AppFrame renders the only open affordance — a floating top-left control localized through the new `layout` locale namespace — while closed; opening rides the existing drawer overlay unchanged. Between the drawer breakpoint and `SIDEBAR_AUTO_COLLAPSE` the rail behavior is untouched. The conversation header clears the corner button via a `data-sidebar-offframe` CSS rule.
- **Header more-options menu** (`ui-workspace`): a third registration, `SessionOptionsAction` into `conversation.session.header.utilities`, offers rename/fork/move/download/archive for the current session through injected verbs — rename via `session.rename`, fork via `sessions.fork({ increaseTitle: true })`, move/archive via the workspaces service, and download via the export feature's `sessionLogDownload` controller (`ctx.get`, optional by design). The download row disables while that session's export is in flight, reading the controller's store through the inject `hooks` compartment; without an exporter in the composition the row drops. The export package's own `Session log` capsule was removed — its registration now mounts only the shared result dialog, so every trigger surface reports preparing/success/error in one place. Rename and move dialogs are component-local state, so a session switch discards a pending edit together with its target. A blank provisional session renders no entry, matching the row-menu rule.

## Alternatives considered

- **Hard-code the reveal button's aria-label** instead of adding a locale seat to ui-layout: lost because product copy routes through locale dictionaries everywhere else, and the layout package already dev-depended on the locale plugin.
- **Render the mobile open button inside the conversation header** (a session-scoped slot): lost because the hero/no-session state has no header, leaving screens without any open affordance; the frame owns the geometry decision, so the frame owns the button.
- **A true host-side session delete**: lost for this change — the wire surface has `workspace.archiveSession` but no session-delete RPC; archive (hidden from all grouping surfaces, log retained) is the existing destructive-adjacent verb, so the menu uses it.
- **Keep the `Session log` capsule beside the menu**: lost because two triggers for one verb is exactly the header clutter this entry removes; the capsule's unique value — its result dialog — stays mounted by its own registration.

## Consequences

The closed-sidebar rail disappears entirely on phone-sized frames, so anything that relied on hovering the rail's icons there must use the new corner button instead. `conversation.session.header.utilities` still carries two shipped entries — the export feature's dialog-only mount and this menu — and ui-workspace now type-depends on the export package (peer + dev + manifest edge) while resolving its controller through `ctx.get` at apply time, so a composition without the exporter boots fine but offers no download row. Bubble collapse thresholds are presentation constants (264/240px), not configuration; they are deliberately fixed geometry like the rest of the bubble spec. The pre-existing verifier violations for `ui-layout`/`dsh-client-connection` and `ui-shell-command`/`dsh-client-ui-slots` manifests remain and belong to separate in-flight work.

## Testing

`packages/client/ui-conversation/tests/chat-bubble-collapse.client.spec.tsx` pins clamp/expand/re-measure behavior (scrollHeight stubbed on the HTMLElement prototype); `packages/client/ui-workspace/tests/session-options.client.spec.tsx` covers blank suppression, direct fork/archive/download dispatch, the in-flight disabled row, the exporter-less row drop, and both dialogs; `packages/session-query/session-log-export/tests/client-apply.client.spec.tsx` pins the dialog-only mount; `packages/client/ui-layout/tests/app-frame.client.spec.tsx` extends the drawer suite with off-frame tracks, the corner button, and the rail-retaining band above the breakpoint.
