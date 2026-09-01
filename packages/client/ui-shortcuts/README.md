# @deepseek-ai/dsh-client-ui-shortcuts

English | [中文](README.zh.md)

Global keyboard shortcuts plugin, browser half: one document-level keydown listener dispatches fixed chords to the same client services the buttons use. The plugin renders nothing and owns no store. `Ctrl+N` cannot serve New Session — browsers reserve it for a new window and never deliver it to the page — so the chord is `Ctrl/Cmd+Shift+S` (S = Session).

- `Ctrl/Cmd+B` — toggle the sidebar column (open ⟷ collapsed).
- `Ctrl/Cmd+Shift+S` — start a New Session (same flow as the sidebar's New Session button: the explicit, current-Session, or recent Workspace's blank session, or the blank New Session view when none exists).
- `Ctrl/Cmd+.` — open the details panel (the right-hand tool/details column; a no-op while it is already open).
- `Ctrl/Cmd+Shift+F` — focus the composer input (the first editable textarea in the document; a dialog's textarea wins while one is open).

Both chords require the primary modifier exactly: no Alt, and the per-chord Shift state. Repeats and IME compositions never fire, and a `defaultPrevented` event is left to the component-level handler that claimed it, so the composer's own keys keep priority. The listener binds at apply and is removed on fiber disposal.

## Model Experience

None, as the chords call client-side actions (`layout.toggleSidebar()`, `workspaces.startSession()`, `layout.openDetails()`, and a DOM focus) that never reach a model request.

#### KV Cache effect

None; this plugin neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **`Ctrl+N` is browser-reserved** — a new window, never delivered to the page. New Session therefore uses `Ctrl/Cmd+Shift+S`; there is no way for a page to reclaim `Ctrl+N`.
- **Firefox reserves `Ctrl+Shift+S` for its screenshot tool** — the chord does not fire there. Chrome, Edge, and Safari leave it free.
- **The chords are fixed** — there is no user-facing remapping surface; adjusting them is a code change in this package.
