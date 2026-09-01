# Agent Note: Android GitHub Release APK updates

Status: implemented

English | [中文](2026-08-31-android-release-auto-update.zh.md)

## Problem

Harness Remote is distributed as an Android APK, so users otherwise need to find a later GitHub Release, download its asset in a browser, and begin installation outside the app. That flow can select a preview, an unrelated release asset, or an APK that cannot replace the installed app. Android does not permit an ordinary app to silently replace itself.

## Decision

At application startup, `AppUpdatePlugin` makes one best-effort request to `https://api.github.com/repos/Mailo037/deepseek-harness/releases/latest`. It accepts only a published, non-draft, non-prerelease Release whose tag is exactly `android-vMAJOR.MINOR.PATCH` and whose asset is exactly `harness-remote-android-vMAJOR.MINOR.PATCH.apk`. `ReleaseVersion` compares all three numeric components, so a stable update cannot be mistaken for a preview or a downgrade.

The plugin downloads the selected asset into the app-private `cache/updates` directory. Before opening an installer it requires the app package id, the declared release version, a version code greater than the installed APK, and an exact installed signing certificate match. `FileProvider` exposes only that cache directory to an `ACTION_VIEW` package-installer intent. Android retains the system install confirmation and any required unknown-source authorization; the app never opens a browser or GitHub page and never installs silently.

The Android `versionName` comes from `apps/android/package.json`; `native/app.build.gradle` holds the initial version code of `1`. Each later Android Release increases that version code while retaining the signing certificate. `scripts/sync-native.mjs` copies native source, resources, assets, and JVM tests into Capacitor's generated Gradle project, and the Android workflow invokes the same sync command.

## Testing

`ReleaseVersionTest` covers accepted stable tags, rejected preview and ambiguous tags, and semantic ordering. Android Gradle unit tests compile the native updater with the generated project; TypeScript tests and type checking cover the startup bridge.

## Alternatives considered

**Open the GitHub Release in a browser.** Rejected because it breaks the in-app update flow and leaves asset selection to a browser download path.

**Accept any APK asset on the latest release.** Rejected because the repository carries releases for more than the Android client; an explicit tag and filename make the update target unambiguous.

**Use a prerelease when it is numerically newer.** Rejected because a stable installation must not move to a preview without an explicit preview channel.

**Use Android silent installation.** Rejected because ordinary third-party apps lack that authority. The system package installer verifies the installation and collects user confirmation.

## Consequences

Stable Android releases have one tag and asset naming rule, and a transient GitHub failure never interrupts pairing or the remote GUI. The app refuses a release when its APK is signed differently or has an equal or lower version code; Android presents any source-install authorization that remains necessary. Key rotation or a different distribution signer requires a separately coordinated migration because the updater deliberately refuses it.
