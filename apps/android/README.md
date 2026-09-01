# Harness Remote — Android thin client

English | [中文](README.zh.md)

The Android app for **DeepSeek Harness Remote** (Phase 2): a QR-code pairing
flow, a WebView of the PC-served web GUI, and a native foreground service that
keeps a persistent WebSocket to the PC's `/remote/device` channel and posts
Android notifications when a session needs attention.

## Thin-client contract

The app **never bundles the web GUI**. The GUI is served by the PC
(`dsh --profile web`) and loaded fresh in a full-screen iframe on every
connect — an app update is never needed for GUI improvements. The APK contains
only:

1. **Pairing screen** — scan the QR code (Settings → Remote devices →
   「生成配对码」) or enter the server URL + pairing token manually; performs the
   `pair` handshake and stores the device secret plus the GUI access token
   returned by the host. QR and manual pairing therefore authenticate the
   embedded GUI identically.
2. **Connected screen** — full-screen iframe of the remote GUI with a quiet status bar, a branded loader, connection-lost UI (probe + retry button + 10 s auto-reprobe + offline banner), and a connection-details popover. After each iframe load, the app announces its informational Android shell context; the served GUI keeps content visible during reconnects and reports its live connection state back to the parent. The status bar animates vertically between `Remote` and `Reconnecting`, while the server origin starts blurred behind a `Show` control in the details popover. A selected Tailscale endpoint also triggers a native Android VPN-transport check, so slow loading and unreachable states tell the user when to enable Tailscale.
3. **Notification foreground service** (`DeviceChannelService`) — the
   persistent WebSocket authenticated with the device secret; posts a
   notification for every host `notification` frame and reconnects with
   backoff.

The local pairing and connection chrome imports the Web GUI's `ui-theme`
base, design-platform, and shadow/type token sheets directly. Android CSS
therefore owns composition and mobile ergonomics only: safe areas, screen
transitions, primary touch targets, and the compact 40 px connected bar. Color schemes, semantic colors, surface hierarchy, borders, typography, shadows, radii, and motion durations follow the same source of truth as the Web GUI. Visible labels remain in sentence case.

## Directory layout

```
apps/android/
  src/                 App UI (React + Vite, built into dist/)
    PairingProtocol.ts Wire types + QR payload parsing (mirror of the host package)
    PairingService.ts  In-app pair handshake over WebSocket (reports stage progress)
    DeviceStorage.ts   Server URL, device secret, and GUI token persistence
    NotificationService.ts  Bridge to the native plugin, including Android VPN state
    AppUpdate.ts       Start the native GitHub Release APK update check
    ShellProtocol.ts    Versioned embedded-GUI connection-state parser
    ScanScreen.tsx     QR scan + manual pairing (swaps to the connecting flow on attempt)
    ConnectingScreen.tsx    Animated connecting flow: three steps, endpoint, cancel
    ConnectedScreen.tsx     Remote GUI iframe + status bar + connection-lost UI
    components/Brand.tsx    Logo mark + stroke icon set (currentColor, follows theme)
    systemBars.ts      Android status-bar style/background synced to color scheme
  native/              Custom native parts copied over the generated project
    AndroidManifest.xml  Permissions + service declaration
    ai/deepseek/harness/remote/
      DeviceChannelPlugin.kt   Capacitor bridge (start/stop/permission)
      DeviceChannelService.kt  Foreground service (WebSocket + notifications)
      AppUpdatePlugin.kt       GitHub Release APK download + installer handoff
      ReleaseVersion.kt        Strict stable Android Release tag comparison
  capacitor.config.ts  Capacitor configuration
  android/             Generated native project (NOT checked in; `cap add android`)
```

## Build

Prerequisites: Node ≥ 22, pnpm, and the [Android SDK](https://developer.android.com/studio)
(ANDROID_HOME set).

```sh
# One-time: generate the native Android project from capacitor.config.ts
cd apps/android
pnpm install
pnpm cap add android
pnpm cap sync android

# Synchronize the checked-in native additions into the generated project.
pnpm cap:sync

# Build the debug APK
pnpm android:build
# → apps/android/android/app/build/outputs/apk/debug/app-debug.apk
```

`pnpm android:build:release` builds the release APK (signing is out of scope
for this repository; use your own keystore).

CI builds a debug APK on every push to `apps/android/**` and uploads it as a
workflow artifact ([`.github/workflows/android-release.yml`](../../.github/workflows/android-release.yml)).

## Release updates

At startup, the app makes a best-effort request for the latest stable GitHub
Release in `Mailo037/deepseek-harness`. A release is an Android update only
when its tag is `android-vMAJOR.MINOR.PATCH` and it contains the exactly named
`harness-remote-android-vMAJOR.MINOR.PATCH.apk` asset. Drafts, prereleases, malformed
tags, missing assets, older/equal versions, and failed or rate-limited requests
are ignored without blocking pairing or the remote GUI.

The app downloads a matching asset into its private cache, checks its package
id, version code and release version, and requires the installed signing
certificate. It then opens Android's package installer using a narrow
`FileProvider` URI; it does not open a browser or GitHub. Android still owns
the installer confirmation and any required per-app unknown-source approval,
so the app cannot silently install an update. Release APKs must keep the signing
certificate and use a higher Android version code. `versionName` comes from
`apps/android/package.json`; bump `versionCode` in `native/app.build.gradle`
for every release after the initial value of `1`.

## Dev workflow: build + serve on the LAN in one step

For the remote-device flow you usually build the app and then serve the GUI so
the phone can reach it (`dsh --profile web` plus `--trusted-host`). The
`dsh-dev` helper does both from one command:

```sh
pnpm dsh:web --trusted-host 192.168.1.5   # build the web frontend, then serve the GUI on the LAN
pnpm dsh:web                              # --trusted-host defaults to the detected LAN IP
pnpm dsh:web --full                       # also rebuild the harness before serving
pnpm dsh:web -- --profile web --port 3080 # extra flags after "--" pass through to dsh

pnpm dsh:build                            # typecheck + build the Android app web assets
pnpm dsh:build --apk                      # ... also sync Capacitor and build the debug APK
```

`dsh:web` runs `pnpm build:web` and then
`pnpm dsh --profile web --trusted-host <ip>`, adding the trusted-host fence
from the pairing steps above; the LAN IP is auto-detected unless you pass
`--trusted-host` explicitly.

## Pairing the first time

1. On the PC: `dsh --profile web` (add `--trusted-host <LAN-IP>` if you reach
   the GUI over the LAN).
2. In the GUI: **Settings → 远程设备 / Remote devices → 生成配对码 / Generate
   pairing code**.
3. In the app: **Scan QR Code** — the app tries the endpoints from the QR
   payload in order (LAN first, then any configured extras), pairs, and
   navigates to the GUI.
4. The app opens the authenticated GUI as soon as the paired config is stored.
   The foreground service and Android notification permission start afterward;
   either may fail without trapping the app on the connecting screen. The host
   pushes `turn-error` / `turn-completed` notifications to the service.

Manual pairing: enter the server URL (`192.168.1.5:3080`) and the token shown
in the pairing card.

## Known Limitations and Deferred Work

- The `android/` Gradle project is generated by `npx cap add android`; the
  checked-in `native/` directory contains the custom sources that must be
  copied over after generation. CI does this automatically.
- The app does NOT bundle the web GUI (thin-client contract). The GUI is
  loaded fresh in an iframe from the PC on every connect — an APK update is
  only needed for the pairing shell or native capabilities.
- Notification permission is requested on Android 13+; the OS settings screen
  is the fallback if the user denies it once.
- The GUI iframe needs the PC to be reachable; WebSocket notifications keep
  working independently of the iframe (the service runs even when the app is
  backgrounded).
- QR scanner uses `capacitor-barcode-scanner` (camera permission); a
  self-contained zxing-free scanner is a follow-up.
- The host's `--trusted-host` fence must include the PC's LAN IP for the
  browser API calls to succeed from the app's iframe.
- The foreground service uses the `specialUse` foreground-service type
  (with `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`): with `targetSdk = 36`,
  `dataSync` would carry a 6-hour timeout and could not start from
  `BOOT_COMPLETED`. A `BootReceiver` restarts the channel after a device
  reboot. Reconnection sweeps the stored endpoints with exponential backoff
  (1 s base, 60 s cap, jitter) plus an immediate retry on network-availability
  and Doze-exit events.
- The app stores every endpoint from the QR payload plus the
  last-successful origin and falls back between them automatically —
  Wi-Fi ↔ mobile data and Tailscale work without re-pairing. For Tailscale
  access, configure the host with `--host 0.0.0.0` +
  `--trusted-host <TAILSCALE_HOST>` and add the Tailscale endpoint to
  `config.endpoints`.
- Tailscale detection recognizes its `100.64.0.0/10` IPv4 range, `fd7a:115c:a1e0::/48` IPv6 range, and `*.ts.net` names. Android reports whether any network exposes `TRANSPORT_VPN`; the app uses that fact only for connection guidance and does not treat it as authentication.
- The authenticated foreground channel returns the current GUI token on every
  reconnect. The native service writes it directly to Capacitor Preferences,
  and the open connected screen periodically reconciles that native state
  before reloading the iframe. This repairs stale token state even when the
  WebView misses the channel event, without clearing app data or pairing again.
- Battery optimization should be disabled for Tailscale ("Unrestricted") and
  for this app ("Never sleep") — otherwise Doze drops the tailnet connection
  and the device WebSocket for minutes at a time.
