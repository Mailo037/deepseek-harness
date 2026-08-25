# Agent Note: Sidebar pull-to-refresh reloads the whole browsing domain

Status: implemented

English | [中文](2026-08-25-sidebar-pull-to-refresh.zh.md)

## Problem

The mobile sidebar had no way to re-run the initial load when a Workspace or
Session baseline loaded incompletely or went stale. Reconnecting was the only
full reload path, and it was not user-invokable; users had to reload the page.

## Decision

`WorkspaceBrowser` (the `sidebar.workspaces` region) gains a touch-only
pull-to-refresh gesture on the wide browsing list. The gesture engages when a
touch pull starts at `scrollTop === 0`, the movement is vertical-dominant, and
the pull exceeds 8px; it shows an expanding indicator strip with localized
"pull / release / refreshing" labels, and a release past 64px fires the reload.

The reload is a new runtime capability, not a UI-local refresh:

- `ISessions.refreshAll()` — a new face member on the sessions service,
  implemented as `SessionManager.reloadAll()`, which re-runs the exact
  per-generation rebuild the reconnect path (`handleConnected`) runs: the
  `session.list` baseline pull, every consumed subagent catalog refresh, and a
  resync of every opened conversation window.
- `IWorkspaces.refresh()` — the existing `WorkspaceRuntime.refresh()` baseline
  pull, now on the outward face so features can invoke it.

The `ui-workspace` apply wires `refreshAll` (both services, in parallel) into
the browser's injected actions. The pull indicator honors reduced motion, and
`overscroll-behavior-y: contain` on the list keeps the browser's native page
pull-to-refresh from chaining into the gesture.

## Alternatives considered

**Expose only list refreshes.** The user asked for "everything" — if a load
broke, an open window could be broken too. Reusing the reconnect rebuild keeps
one definition of "full reload" instead of a weaker list-only variant.

**A visible refresh button instead of a gesture.** Mobile pull-to-refresh is
the platform convention the user asked for; a button would also work but adds
header chrome and does not match the request.

## Consequences

`SessionManager.reloadAll()` is now the single implementation behind both
reconnect and the user gesture; `handleConnected` delegates to it. The
`ISessions` / `IWorkspaces` face widenings require the test doubles
(`TestSessions.refreshAll`, `TestWorkspaces.refresh`) to implement the new
members, which they do as recorded inert calls. Runtime coverage: the manager
spec verifies `reloadAll` repulls the baseline and resyncs opened windows, and
the sessions-service spec verifies the `refreshAll` entry. UI coverage:
`workspace-browser.client.spec.tsx` verifies the pull labels, the release
trigger, the below-trigger cancel, and the horizontal-movement guard.
