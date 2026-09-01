# Agent Note: Remote device plane for the Web GUI

Status: implemented

English | [中文](2026-09-02-remote-device-plane.zh.md)

## Problem

The Web GUI is loopback-bound by design: `dsh --profile web` refuses `--host 0.0.0.0` because the surface is remote code execution, and every client that reaches it goes through the browser-trust fence. A user who wants to drive the agent from a phone — the "DeepSeek Harness Remote" product direction — has no supported path: no device pairing, no push of session attention events, no way to revoke a stray device, and no UI to manage any of it.

## Decision

**A device plane mounts inside the web profile, behind explicit pairing instead of an open port.** `@deepseek-ai/dsh-host-remote` owns four responsibilities:

- **Pairing** — `pairingCreate()` mints a one-time token with a configurable lifetime and returns a QR payload carrying the endpoint list (auto-detected LAN IPv4s plus configured extras). The payload is JSON (`v: 1`), so a future Android client can carry several endpoints and try them in order.
- **Durable registry** — paired devices persist in the `remote_devices` storage domain (device id, name, platform, SHA-256 secret hash, created/last-seen). Only the hash reaches the medium; the invariant companion fails any write whose `secretHash` is not a 64-hex digest.
- **Device channel** — a WebSocket upgrade route at `/remote/device` accepts a `pair` (token) or `auth` (secret) first message. A pair creates the record and hands the device its secret; auth reconnects, refreshes `lastSeenAt`, and returns the current GUI access token so a paired app repairs stale token state without re-pairing. The channel replaces a device's older socket on reconnect and terminates it on revoke.
- **Notification bridge** — the plugin subscribes to `session/event` and broadcasts a frame to every connected device when a turn ends with an error or completes (both configurable). Offline devices miss frames; pull-on-reconnect is deferred.
- **GUI authentication** — the QR payload carries a persistent GUI access token. The index script retains it in session storage, publishes `__DSH_REQUEST_AUTH__.query`, and sets a same-origin fallback cookie. The browser connection carrier attaches the query token to unary HTTP, Typert Remote, and both WebSocket downlinks, so an Android WebView iframe does not depend on third-party cookie policy.
- **Android shell presentation** — after each GUI iframe load, the app sends a versioned `postMessage` announcement. The browser connection service exposes it as informational shell context, letting the layout retain the current content and show a compact reconnect indicator instead of the ordinary full-screen overlay. The Android status bar hides the server origin and disconnect action behind an explicit details control.
- **Shared visual system** — the Android pairing and connection chrome imports the Web client's base, design-platform, and shadow/type token sheets. It reuses their semantic surfaces, labels, borders, states, typography, radii, shadows, and motion while retaining Android-specific safe areas and 44/48 px touch targets.

The browser surface reads and drives the plane through the `device` Remote namespace (`pairingCreate`, `devicesList`, `devicesRevoke`), mounted by `@deepseek-ai/dsh-api-remotes`. `@deepseek-ai/dsh-client-ui-remote` registers the Settings section "Remote devices" (id `remote`, order 15): QR generation with payload copy, the paired-device list with live connection status, and instant revoke — socket kill and registry removal in one call, no undo.

**The existing safety posture is untouched.** The `0.0.0.0` CLI guard, the browser-trust fence, and the loopback-pinned privileged methods stay as they are; the channel is reachable wherever the composed `webServer` binds, and a remote deployment must still use a non-loopback bind in a profile patch or a tunnel.

## Testing

`packages/host/remote/tests/` covers the plane at four levels: pairing unit tests (one-time consumption, expiry, endpoint building), registry tests over the real storage-domain machinery (memory backend, persistence across reopen), a real HTTP+WebSocket channel suite (pair, reject, reconnect, notify, revoke, broadcast), and a `RemoteGateway` suite mounted on the real `WebServer` (`127.0.0.1:0`) asserting the namespace methods, one-time tokens over the wire, and revoke-kills-socket end to end. The bridge suite emits `session/event` `turn/end` frames and asserts the notification frames a connected device receives. The client package carries a component spec (jsdom, mocked `qrcode`) and a browser-plugin spec (registration, locale following, lazy Remote reads).

## Alternatives considered

**Serve the channel on a dedicated port outside the webserver.** Rejected: a second listener would need its own TLS/tunnel story and would not inherit the profile's bind configuration; the webserver upgrade registry already owns route lifecycle and teardown.

**Authenticate the channel with a shared secret configured at boot.** Rejected: there is no boot-time secret store for this plane, and a static secret cannot be revoked per device; one-time pairing plus per-device secrets gives revocation for free.

**Subscribe the bridge to the api-proxy's session summaries instead of `session/event`.** Rejected: summaries are a browser-facing projection and computing them host-side would couple the plane to the gateway; durable `turn/end` carries the same attention facts with the session log as the single source.

**Store the device secret in the registry.** Rejected: a registry read is a compromise of every device; hashing keeps the medium safe and the channel auth is one hash lookup.

**Push notifications through a pub/sub relay for offline delivery.** Rejected as Phase-1 scope creep; the channel is connection-scoped and the Android app (Phase 2) will define the offline policy.

**Rely only on a SameSite cookie for GUI authentication.** Rejected: the Android app embeds the PC-served GUI under the Capacitor origin, where WebView may omit third-party iframe cookies from WebSocket upgrades. Explicit query authentication uses the same server-side token check for every browser carrier.

**Treat the Android shell announcement as authentication.** Rejected: `postMessage` is a presentation hint that another embedding page can reproduce. API authorization continues to depend only on the GUI access token and existing trust checks.

**Show the server origin and a full-screen reconnect overlay in the normal Android flow.** Rejected: the origin is diagnostic information, not a primary task, and the overlay hides usable session content during transient recovery. Connection details remain available on demand while the persistent status control communicates recovery without blocking the GUI.

## Consequences

The device plane makes the Web GUI reachable from a paired phone while preserving per-device channel revocation and a separate persistent GUI token. Browser request URLs carry that GUI token when explicit authentication is active, including both WebSocket upgrade URLs; deployments must therefore treat access logs as sensitive. Authenticated channel reconnects refresh the app's persisted GUI token directly from the native foreground service, and the connected screen reconciles the authoritative native state while open. Host token rotation, a missed WebView channel event, or legacy app state therefore cannot strand the iframe in an endless reconnect loop. Session storage keeps an authenticated iframe connected across a document reload, while closing its tab drops the retained token. The cookie path still supports ordinary same-origin browsers, but Android correctness does not depend on WebView cookie policy. The shell announcement changes presentation only: Android users retain their current content during reconnects and open connection details deliberately, while ordinary browser behavior remains unchanged.
