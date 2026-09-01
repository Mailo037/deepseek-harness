# Agent Note: Android pairing commits before optional notification setup

Status: implemented

English | [中文](2026-08-30-android-pairing-commits-before-notification-setup.zh.md)

## Problem

Android pairing could succeed on the host while the app remained on the connecting screen. The app awaited notification permission and foreground-service setup before storing the paired config and changing routes, although neither operation establishes GUI access. Manual pairing also stored an empty GUI access token because only the QR payload carried it; the iframe then loaded without request authentication and entered its reconnect flow.

## Decision

The host's `paired` reply carries the device id, device secret, and persistent GUI access token. Both QR and manual pairing take GUI authentication from that authenticated WebSocket reply, so the two entry paths produce the same stored config.

After the pair reply passes wire validation, the app stores the complete config and changes to the connected route. `ConnectedScreen` starts the foreground service on mount, including restored sessions, while the notification permission request runs independently after pairing. A stalled or rejected notification call may suppress Android attention banners but cannot delay or invalidate GUI access.

## Alternatives considered

**Keep the GUI token only in the QR payload.** Rejected: manual entry would continue to create a valid device secret but an unauthenticated iframe, making the advertised fallback path incomplete.

**Await notification setup with a timeout.** Rejected: a timeout would still delay the primary flow and choose an arbitrary failure threshold for optional functionality.

**Navigate before persisting the paired config.** Rejected: process death after navigation would lose the only copy of a valid device secret after consuming the one-time pairing token.

## Consequences

- Possession of a valid one-time pairing token authorizes receipt of both device-channel and GUI credentials. The pairing token and `paired` reply remain secrets.
- GUI navigation depends only on the pair handshake and durable config write. Notification setup is recoverable and retried when the connected screen mounts.
- The Android device smoke server requires GUI requests to present the access token, preventing a successful device handshake from masking a broken iframe login.

## Testing

The host channel and gateway tests cover the extended reply and GUI token equality. Android typecheck, unit tests, production asset build, Capacitor sync, and debug APK assembly pass. On the Android emulator, manual pairing reaches the connected route before the ungranted notification dialog completes, and the mock PC records authenticated GUI requests. The pre-granted device lane covers paired, persisted, disconnect, cleared, and error flows.
