# Agent Note: Guided onboarding recovery

Status: implemented

English | [中文](2026-08-22-guided-onboarding-recovery.zh.md)

## Problem

The first-run Models step treated an absent adapter, inactive route, failed join, or read-only credential path as a reason to complete silently. A new user then returned to a composer that still could not make a useful request, with no explanation or next action. The separate Workspace picker already owned directory selection and adoption, but onboarding had no way to send a user to that existing interaction.

## Decision

`ui-settings-models` keeps ownership of the ordered first-run step. It renders a recoverable dialog for every Models readiness result that cannot serve requests, names the relevant condition, and opens the existing Models section through the onboarding owner callback. The missing-key form retains its write-only `credentials.set` path and now also exposes that Models action. **Configure later** completes only the current coordinator pass; it does not report a configured provider.

When a provider is usable, the same step shows a compact three-part journey: provider, workspace, then first task. A missing Workspace offers **Choose workspace**. That action calls the optional `workspacePickerRequests` service rather than creating a picker, selecting a backend, or adopting a path. `ui-workspace` receives the monotonic request in its mounted hero `WorkspacePicker` and raises the same directory-flow slot as the sidebar **Add workspace** action; the composed native or browse occupant alone selects the implementation. This external request bypasses the ordinary composer Workspace menu, whose **Choose workspace** control still opens the menu with its standalone target and **Add workspace...** action even when no Workspace exists. The Workspace step remains mounted and visible behind the external chooser, with both actions disabled while the request owns the interaction. Cancellation restores the actions in place, while a completed pick advances the same onboarding surface to the final handoff. Both this step and that handoff expose **Skip for now**: it completes only the current coordinator pass, without selecting a Workspace, creating a Session, or recording successful configuration.

This is browser-only presentation. No new model-visible data reaches the agent loop, so no session event is introduced.

## Alternatives considered

**Continue completing unavailable states silently.** Rejected because it leaves a first-run user without a working route or a path to diagnose it.

**Give onboarding its own directory picker.** Rejected because it would duplicate directory-flow selection, backend selection, cancellation, and Host path adoption already owned by `ui-workspace`.

**Make Configure later mean provider-ready.** Rejected because a deferral is not a successful configuration and must not suppress later recovery.

**Force Workspace or first-task completion.** Rejected because a user may need to defer setup while retaining the ordinary picker and composer for later use.

## Consequences

Every missing or unavailable model path has an actionable Models recovery route. A user who does have a provider progresses to the existing Workspace selector and then receives a concise first-task handoff, or explicitly defers either without producing a Workspace or Session. The optional picker request is inert in a composition without `ui-workspace`; onboarding keeps its Workspace dialog open and says that selection is unavailable rather than completing falsely.

Focused Models and WorkspacePicker component coverage pins recovery actions, explicit deferrals, the provider-to-workspace-to-task progression, and the request signal. The assembled browser first-run scenario snapshots the welcome, missing-key, and Workspace dialogs, invokes **Open Models**, and confirms that **Skip for now** leaves the ordinary picker available.
