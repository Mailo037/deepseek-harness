# @deepseek-ai/dsh-host-remote

English | [中文](README.zh.md)

Remote device plane for the Harness Web GUI: pairs devices (Android, any WebSocket client) via one-time QR codes, keeps a durable device registry, pushes session attention events to connected devices, and enforces instant server-side revocation.

The browser surface drives this plane through the `device` Remote namespace (`ctx.remote.device.*`); a device speaks the WebSocket channel protocol directly at `DEVICE_PATH` (`/remote/device`).

## Semantics

- **Pairing** — `pairingCreate()` issues a one-time token (lifetime `pairingTtlSeconds`) plus a QR payload carrying the endpoint list (auto-detected LAN IPv4s, then configured `endpoints`). A device presents the token as its first channel message; the server replies `paired` with a device id, device secret, and persistent GUI access token, then persists a record holding only the SHA-256 secret hash. Returning GUI authentication in this reply keeps QR and manual pairing equivalent.
- **Reconnect** — a paired device presents its secret (`auth`); the server replaces any older socket of the same device, refreshes `lastSeenAt`, and returns the current GUI access token so the app can repair stale persisted authentication.
- **GUI authentication** — every non-loopback `/api` request presents the persistent QR access token. The injected index script keeps it in session storage and supplies it to the browser connection carrier for HTTP and WebSocket query authentication; a cookie remains the same-origin browser fallback.
- **Notifications** — the bridge subscribes to `session/event` and broadcasts a frame to every connected device when a turn ends with an error (`notifyOnError`) or completes (`notifyOnCompleted`). Notification text identifies the session by its latest durable title, with the session id as a fallback before a title exists.
- **Revocation** — `devicesRevoke()` terminates the live socket immediately, removes the registry record, and thereby invalidates the secret: the device cannot reconnect and must pair again.

## Config

| Field | Default | Meaning |
|---|---|---|
| `endpoints` | `[]` | Extra authorities appended to the auto-detected LAN endpoints in the QR payload (tunnel addresses, Tailscale names) |
| `pairingTtlSeconds` | `300` | Pairing token lifetime in seconds (10–86400) |
| `notifyOnError` | `true` | Broadcast on `turn/end` with an error reason |
| `notifyOnCompleted` | `true` | Broadcast on `turn/end` with the completed reason |
| `printPairingQr` | `false` | Print a pairing QR to stdout on activation |

The WebSocket channel itself is reachable wherever the composed `webServer` binds. The `dsh web` CLI still refuses `--host 0.0.0.0`; a remote deployment reaches the channel through a non-loopback bind in a custom profile patch or through a tunnel, and must never weaken the browser-trust fence (`--trusted-host`).

## Remote namespace (`device`)

- `pairingCreate()` → `PairingView`
- `devicesList()` → `RemoteDevicesSnapshot` (includes live `connected`)
- `devicesRevoke({ deviceId })` → `RevokeReceipt`

## Model Experience

None, as the plane registers no model-facing tool, prompt section, or session event and only reads existing session events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Offline devices miss notifications** — a broadcast reaches only devices holding a live socket; a device that reconnects later has no pull path for missed frames.
- **Terminal QR is boot-time only** — `printPairingQr` prints one code at activation; the browser surface (Settings → Remote) is the interactive pairing UI.
- **One channel, one server** — there is no multi-host discovery or automatic tunnel setup; the QR payload carries the endpoint list the deployment configured.
- **No visual confirmation code** — pairing is token-only; the planned 6-digit device-side confirmation (WhatsApp-Web-style) is future work.
- **No per-device notification filters** — broadcasts go to every connected device.
