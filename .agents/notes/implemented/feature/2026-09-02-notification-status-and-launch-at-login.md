# Agent Note: Browser notification status display and launch-at-computer-start preference

Status: implemented

English | [中文](2026-09-02-notification-status-and-launch-at-login.zh.md)

## Problem

The notification-sounds row showed only the feature's own on/off switch. Whether system notifications can actually appear is a browser permission the user controls in the browser, outside the app: a user who enabled the feature could not see that the browser had blocked notifications, and a browser showing no prompt (never asked) looked identical to one that granted. Separately, desktop users had no way to start the app automatically when the computer starts.

## Decision

**Browser notifications.** The `ui-notifications` runtime reads the browser's `Notification.permission` through an injectable face and publishes it in every snapshot as `permission` (`granted` / `default` / `denied` / `unsupported`). The settings row shows a live status line with a state dot, an explicit "Ask" affordance while the state is `default`, and a hint naming the browser's site settings when blocked — the switch itself stays the feature opt-in and now triggers the permission request when turned on. Because the Notification API has no permission-change event, the client re-reads the state on document visibility changes and window focus, so a grant made in the browser's site settings reaches an open page without a reload.

**Launch at computer start.** A new `ui-launch` client package owns the durable `ui-launch` settings namespace (`launchAtLogin`) and a General-settings row. The backend seam is application-owned: the Host half's `ctx.inject(['settings', 'launchSettings'])` waits for the surface's backend, registers the namespace only where one exists, and applies committed values through it. Two backends ship: the Electron main provides a login-item backend over `app.setLoginItemSettings` (Windows always; packaged macOS only; Linux reports unsupported), and the web bundle's `web-launch-item` row provides a Windows per-user registry Run-key backend (`HKCU\...\Run`, value `DeepSeekHarness`) whose command relaunches `pnpm dsh --profile web --no-open` from the installation root the backend sampled at provide time — a macOS or Linux web host provides nothing, so the row renders nothing there. Where no backend is composed the namespace stays unregistered, so a switch that could not act never appears. The initial application runs only when a user override is already stored, so an untouched switch cannot clobber an OS-managed login item; a committed change always applies, which also repairs a stale login-item path after an app update, and unregistering queries the value first so an absent entry is already-satisfied rather than an error. `bootWebHost` stays Electron-free: the Electron backend rides a boot option supplied by the Electron entry, keeping the plain-Node smoke path loadable.

## Alternatives considered

**Projecting the permission state as the row's switch state.** Rejected: the feature opt-in (should sounds play at all) and the browser capability (may system notifications appear) are different decisions a user controls in different places; merging them makes the switch lie about at least one of them.

**Serving launch settings through the API gateway.** Rejected: the preference is a durable user setting like any other, the settings transport already persists and forwards it, and the OS application is surface policy — a gateway method would put Electron-specific semantics into the shared wire contract.

**Reading the OS login-item state back into the UI.** Deferred: Electron exposes `getLoginItemSettings`, but OS policies can mutate entries outside the app; modeling that state honestly needs an event source that does not exist yet. The switch reflects the persisted preference and the backend re-asserts it on the next change or app start.

## Consequences

The snapshot gained a required `permission` field, and the row's injected face gained `requestPermission`; both are additive. The `ui-launch` namespace appears in the settings document only where a backend is composed, and its user section records the user's switch value. Applying the switch writes OS launch state — the Windows web backend writes a per-user registry Run key, the Electron backend writes login items — while the Host settings document remains the single preference authority.

## Testing

Runtime coverage pins permission projection, refresh-on-demand republish, request-only-from-default, and failure containment; row coverage pins status copy, hint, and the request affordance per state. Host coverage pins boot-time application of a stored override, opt-in defaults that never apply, and namespace absence without a backend; Electron coverage pins platform gating (Windows, Linux, unpackaged macOS) and the Electron-free host wiring; the web backend coverage pins the registry command shape, query-before-delete unregister idempotence, and the Windows-only provide. The real-composition host smoke boots the full web profile including the launch backend row. The browser goldens pin the row's renders-nothing state on every host — the e2e scaffold disables `web-launch-item` so Windows and Linux assemble identically — while the row's own visibility is pinned by component specs.
