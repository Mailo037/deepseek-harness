# Agent Note: Tailscale endpoints for the remote device plane

Status: implemented

English | [中文](2026-08-28-tailscale-remote-device.zh.md)

## Problem

The Android remote app stored exactly one server origin. On a phone that moves between home Wi-Fi and mobile data, that single origin dies the moment the Wi-Fi path does: the GUI iframe went unreachable and the device WebSocket stayed down, with no way to reach the PC over the tailnet even though the host already advertised multiple endpoints in the QR payload.

## Decision

**Multi-endpoint persistence with one pure selection module.** The app stores the full normalized endpoint list from the QR payload (loopback aliases dropped — from the phone they can only mean the phone's own loopback) plus the last-successful origin. `EndpointSelection.ts` owns selection as pure functions (`endpointsOf`, `selectCandidates`); the GUI probe and the `NotificationService` both derive their candidate order from it, and the Kotlin service receives the already-ordered `wsUrls` list, so the selection logic exists once. Priority is last-successful → stored order (LAN → Tailscale → extras). A GUI probe success or a channel `authed` writes the winning origin back (`persistLastSuccessful` on both the TS and plugin side), so both planes converge on the same endpoint.

**HTTP over the tailnet instead of `tailscale serve`.** `tailscale serve` proxies to `127.0.0.1`, so the Harness would see every access as loopback and `isLoopbackRequest` would bypass the GUI access-token guard — the defense-in-depth between tailnet membership and GUI auth would collapse to one layer. Direct `http://`/`ws://` over the encrypted tailnet keeps `100.x.y.z` non-loopback, so the guard still applies. No TLS, no certificates, no MagicDNS requirement; `usesCleartextTraffic` was already required for LAN.

**Foreground service type `specialUse`.** With `targetSdk = 36`, `dataSync` carries a 6-hour timeout and cannot start from `BOOT_COMPLETED`; `specialUse` has neither restriction. The manifest declares `specialUse` with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`, a `BootReceiver` restarts the channel after reboot, and `onTimeout` stops the service cleanly as a guard against future platform changes. Devices below Android 14 keep the two-argument `startForeground` (no type validation there).

**Deterministic reconnect.** The Kotlin service keeps OkHttp's `WebSocketListener` shape but sweeps candidates per connection attempt: 10 s connect window per endpoint, first `authed` wins, a `rejected` auth disables reconnect (the secret is invalid or revoked — retrying cannot succeed), and a full failed sweep falls into exponential backoff (1 s base, 60 s cap, 0–50 % jitter, reset on success). `registerDefaultNetworkCallback` and `ACTION_DEVICE_IDLE_MODE_CHANGED` cancel the pending backoff and reconnect immediately, so a Wi-Fi ↔ mobile switch or Doze exit recovers without waiting out the timer.

## One deliberate deviation from the design sketch

The `BootReceiver` sketch read the persisted candidates with `SharedPreferences.getStringSet`, but a `Set` destroys candidate order — the whole point of the last-successful-first priority. The channel parameters are stored as a JSON array string under the same keys (`last_ws_urls`, `last_secret`, `last_device_id`), and `loadChannelParams` is the single reader used by both the `BootReceiver` and sticky restarts (a sticky restart redelivers a null intent and recovers from the same store).

## Testing

`apps/android/tests/` adds vitest unit specs (Node, no emulator): endpoint selection (normalize, loopback filtering, dedupe, candidate ordering) and device-storage migration (legacy single-URL config → `endpoints` + last-successful, identity fields preserved, `persistLastSuccessful` append semantics). The emulator-based device lane under `tests/device/` is untouched. Network-transition behavior (Wi-Fi ↔ mobile, Doze, boot) remains a real-device manual matrix; the selection logic that decides those transitions is the part under unit test.

## Alternatives considered

### `tailscale serve` over the tailnet

Serving through `tailscale serve` proxies to `127.0.0.1`, so the Harness sees every access as loopback and `isLoopbackRequest` would bypass the GUI access-token guard — the single-layer defense between tailnet membership and GUI auth. Direct HTTP/WS over the encrypted tailnet keeps the tailnet address non-loopback, so the guard still applies.

### `dataSync` foreground service

`dataSync` carries a 6-hour timeout at `targetSdk = 36` and cannot start from `BOOT_COMPLETED`. `specialUse` has neither restriction, so the channel can start on boot and stay up for the long-lived remote bridge.

### `SharedPreferences.getStringSet` for persisted candidates

A `Set` destroys candidate order, which the last-successful-first priority depends on. Storing the ordered list as a JSON array string preserves it, and one reader serves both the boot and sticky-restart paths.

## Consequences

The app now converges on one ordered endpoint list, so a Wi-Fi ↔ mobile switch or Doze exit recovers without restarting the channel or losing the GUI connection. The cost accepted: cleartext HTTP/WS over the tailnet carries no TLS or certificates (relying on the encrypted tunnel rather than adding a new trust layer), and network-transition behavior stays a real-device manual matrix rather than an automated test.
