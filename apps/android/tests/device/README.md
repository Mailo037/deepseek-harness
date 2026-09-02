# Device test lane — simulated PC + real emulator

English | [中文](README.zh.md)

End-to-end check for the app UI on a real Android emulator, with the PC side played by a zero-dependency Node mock. The runner drives the app's Capacitor WebView over the Chrome DevTools Protocol and asserts the screens the user would see (no screenshots needed to judge — screenshots are saved as artifacts for human review).

## Components

```
tests/device/
  mock-pc-server.mjs  Simulated PC: fake GUI (iframe target) + /remote/device
                      WebSocket pairing handshake (minimal RFC 6455 server)
  run-smoke.mjs       CDP driver: phases of the app flow with DOM assertions
```

The mock PC implements the wire protocol from `src/PairingProtocol.ts` (`pair` → `paired{deviceId,secret,accessToken}`, `auth` → `authed{deviceId,accessToken}`, or `rejected{reason}`). `GET /__status` returns `{pairs, auths, rejects, guiRequests, authenticatedGuiRequests, shellMessages}` so the runner can assert server-side effects.

## Prerequisites

- Android SDK with an emulator system image, `ANDROID_HOME` set.
- One AVD (any recent image; the lane was built against `Medium_Phone` / API 37 x86_64).
- Node ≥ 22 (built-in `WebSocket` and `fetch`); JDK 21+ for Gradle.

## Run

```pwsh
# 1. Boot the emulator (any working AVD name)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Medium_Phone `
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot

# 2. Start the simulated PCs (fast + slow-for-cancel)
node apps/android/tests/device/mock-pc-server.mjs --port 31223 --token TESTTOKEN123
node apps/android/tests/device/mock-pc-server.mjs --port 31224 --token SLOWTOKEN --latency 8000

# 3. Build and install the app (from apps/android)
pnpm build; pnpm exec cap sync android
cd android; .\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk

# 4. Pre-grant the notification permission so the full smoke runner keeps its
#    DevTools connection while the system dialog would own the foreground.
#    Pairing itself no longer waits for this permission.
adb shell pm grant ai.deepseek.harness.remote android.permission.POST_NOTIFICATIONS
adb shell am start -n ai.deepseek.harness.remote/.MainActivity

# 5. Forward the WebView devtools socket and run the phases
$socket = adb shell cat /proc/net/unix | Select-String webview_devtools_remote | ForEach-Object { ($_ -split '@')[1].Trim() }
adb forward tcp:9223 localabstract:$socket
node apps/android/tests/device/run-smoke.mjs --phase pairing-happy
node apps/android/tests/device/run-smoke.mjs --phase seed-stale-token
adb shell am force-stop ai.deepseek.harness.remote
adb shell am start -n ai.deepseek.harness.remote/.MainActivity
node apps/android/tests/device/run-smoke.mjs --phase persisted      # after force-stop + relaunch
node apps/android/tests/device/run-smoke.mjs --phase disconnect
adb shell am force-stop ai.deepseek.harness.remote
adb shell am start -n ai.deepseek.harness.remote/.MainActivity
node apps/android/tests/device/run-smoke.mjs --phase cleared
node apps/android/tests/device/run-smoke.mjs --phase errors
```

Each phase prints `PASS`/`FAIL` per check and exits non-zero on failure. Screenshots land in `.artifacts/android-device/`.

## What the phases prove

| Phase | Proof |
|---|---|
| `pairing-happy` | Splash → flat manual form → three-step connecting flow → connected: compact status bar, green dot, authenticated iframe loading the mock GUI; mock saw the pair handshake |
| `seed-stale-token` | Replaces the stored GUI token with a truncated value to set up the reconnect regression |
| `persisted` | Relaunch skips pairing, restores the connected screen, and refreshes a stale GUI token from the native channel |
| `disconnect` | Disconnect wipes the state and returns to pairing |
| `cleared` | Relaunch after disconnect shows pairing (no stranded config) |
| `errors` | Wrong token → banner with the server reason; unreachable host → banner without internal jargon; cancel during a slow handshake → back to the form, no banner |

## Known limitations

- The QR path is not exercised (the emulated camera cannot reliably show a scannable code); manual pairing drives the same `PairingService` pipeline.
- The WebView screenshot via CDP captures the app content only, not the system bars; use `adb exec-out screencap -p` for full-device captures.
- The emulator takes several minutes to cold boot; keep it running across phases.
