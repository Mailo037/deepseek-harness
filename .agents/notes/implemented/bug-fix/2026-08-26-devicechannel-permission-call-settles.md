# Agent Note: DeviceChannel permission calls always settle

Status: implemented

English | [中文](2026-08-26-devicechannel-permission-call-settles.zh.md)

## Problem

Pairing from the Android phone succeeded on the host side, but the app sat on "Connecting…" forever and no system permission dialog ever appeared. Root cause: `ensureNotificationPermission()` bridges to `DeviceChannelPlugin.setNotificationPermission`, which called Capacitor's `requestPermissionForAlias("notifications", call, "notificationsPermissionDenied")` while the plugin declared no permission for that alias. In Capacitor 8 (`com.getcapacitor.Plugin#requestPermissionForAliases`), an alias whose `@Permission(strings=...)` resolution comes back empty short-circuits before any launcher lookup, leaving the `PluginCall` neither resolved nor rejected. The JS promise then pends forever, `ScanScreen.startPairing` awaits it before clearing `loading`, and the screen never leaves "Connecting…" although the WebSocket `pair` handshake persisted the device seconds earlier. A second defect hid behind the first: `saveConfig` ran before those native calls, so force-killing the app stranded a stored config whose next Connect attempt sent the already-consumed one-time token to a permanently rejecting server.

## Decision

`DeviceChannelPlugin` declares `POST_NOTIFICATIONS` under alias `NOTIFICATIONS` on its `@CapacitorPlugin(permissions = [...])` annotation, fast-paths an already-granted state, and routes the request to the `@PermissionCallback` method `onNotificationsPermission`, which resolves either way. Resolving instead of rejecting on denial is deliberate: the GUI, the foreground service, and channel authentication do not depend on `POST_NOTIFICATIONS`; a denied grant may silence attention banners but must not invalidate a paired device. The generated-project copy under `android/app/src/main/java/...` stays byte-identical with the `native/` source of record that CI copies over it (see `apps/android/native/README.md`). Pairing navigation no longer waits for this call; [Android pairing commits before optional notification setup](2026-08-30-android-pairing-commits-before-notification-setup.md) owns that ordering.

## Alternatives considered

**Reject the call when the user denies.** Rejected: pairing had already succeeded host-side, so failing the whole flow over banner-only functionality trades a permanent-looking dead end (a retry would hit a consumed one-time token) for stricter feedback nobody needs.

**Call `ActivityCompat.requestPermissions` directly and handle `onRequestPermissionsResult`.** Rejected: re-implements launcher bookkeeping, request codes, and recall handling that Capacitor owns once the alias/callback pair satisfies its contract.

**Wrap `plugin.setNotificationPermission` in a JS timeout.** Rejected: masks the unresolved-call defect behind an arbitrary timer and leaves the same trap armed for every future alias.

## Consequences

- Every DeviceChannel permission call settles deterministically, and pairing correctness no longer depends on its completion.
- A user who denies notifications gets a fully connected app with silent banners; the positive path and this negative guarantee are recorded in the plugin JSDoc and this note.
- Later aliases must appear both in the annotation and as an `@PermissionCallback` method: forgetting either reproduces the silent-skip variant (no dialog, forever-pending call) rather than a crash.

## Testing

The TypeScript app compiles clean, the native source and generated-project copy remain byte-identical, and the Capacitor call graph is pinned by the declared alias plus permission callback. The Android emulator lane reaches the connected screen before an ungranted notification dialog completes, and the pre-granted path covers the full paired, persisted, disconnect, cleared, and error flows.
