# Agent Note: Global keyboard shortcuts for the Web GUI

Status: implemented

English | [中文](2026-08-23-web-keyboard-shortcuts.zh.md)

## Problem

The Web GUI had no global keyboard shortcuts: the only chords were component-scoped (Cmd/Ctrl+Enter in the composer, Escape in dialogs, arrows in menus). Two product-level actions — toggling the sidebar column and starting a New Session — were pointer-only, and `Ctrl+N` (the natural New Session chord) cannot work in a browser: every browser reserves it for a new window and never delivers the keydown to the page. There was no shortcut surface at all to build on.

## Decision

A new client plugin package `@deepseek-ai/dsh-client-ui-shortcuts` (browser half only, no slots, no store) binds one document-level `keydown` listener for the plugin fiber's lifetime and dispatches two fixed chords to the exact services the sidebar buttons use:

- `Ctrl/Cmd+B` — toggle the sidebar column (`ctx.layout.toggleSidebar()`).
- `Ctrl/Cmd+Shift+S` — start a New Session (`ctx.workspaces.startSession()`); the Shift+S chord (S = Session) replaces the browser-reserved `Ctrl+N`.
- `Ctrl/Cmd+.` — open the details panel (`ctx.layout.openDetails()`; a no-op while it is already open).
- `Ctrl/Cmd+Shift+F` — focus the composer input (the first editable textarea in the document; a dialog's textarea wins while one is open).

Chords match exactly (primary modifier, no Alt, per-chord Shift state) so unrelated chords stay out of the plugin's hands. Repeats and IME compositions never fire (hold-to-repeat would flip the sidebar rapidly; a composing chord is input text, not a command), and an already-handled event is left to the component-level handler that claimed it — the composer keeps priority on its own keys. The listener binds at apply and is removed on fiber disposal.

The package registers as a `dsh.client` row in the web-app bundle roster, so it loads with the browser tree like any other surface plugin. There is no user-facing remapping surface; the chords are constants in the plugin.

## Alternatives considered

- **`Ctrl+N` for New Session.** Rejected: browsers reserve it for a new window; the page never receives the keydown, so the chord cannot work.
- **Adding the listener to ui-layout or ui-sidebar.** Rejected: shortcuts are a cross-cutting surface, not the layout frame's or the sidebar shell's job, and a dedicated package keeps the chords and their IME/priority policy in one owned place, following the one-feature-one-plugin convention.
- **A settings row to remap the chords.** Rejected for this delivery: fixed chords match the composer's hardcoded Cmd/Ctrl+Enter precedent; remapping would need a settings surface and per-key storage for little first-cut value.

## Consequences

Both product-level actions now have keyboard equivalents identical in authority to the buttons, and the plugin is the single place future global chords (a command palette, a workspace switcher) can be added. The cost: two chords are fixed product constants, and Firefox reserves `Ctrl+Shift+S` for its screenshot tool, so the New Session chord does not fire there (Chrome, Edge, and Safari leave it free) — documented in the package README's Known Limitations. `Ctrl+N` remains impossible by browser design.
