# Agent Note: Electron first-run updater import

Status: implemented

English | [中文](2026-08-24-electron-first-run-cjs-updater.zh.md)

## Problem

The Electron main entry imported `autoUpdater` as a named ESM export from the CommonJS `electron-updater` package. Electron's native ESM loader rejected that import before `app.whenReady()`, so a fresh source or packaged launch never created the host or window. The built-product smoke then waited for its readiness line until the workflow timeout hid the loader error behind a generic failure.

The source smoke also launched `npx.cmd` directly on Windows. Current Node process spawning rejects that command form with `EINVAL`, so the local reproduction path failed before Electron could expose the application error.

## Decision

Import the CommonJS namespace through its default export and read `autoUpdater` only when the installed-package updater is created. Smoke mode still disables update checks, so first-run verification does not initialize the updater singleton.

The smoke launcher invokes Electron's resolved JavaScript CLI through the current Node executable and gives each run an isolated temporary `DSH_HOME`. Window readiness follows the `loadURL()` promise, and a rejected load shuts smoke mode down with an explicit failure.

## Alternatives considered

**Bundle `electron-updater` into the main entry.** This could hide the module-format mismatch but would make packaging responsible for rewriting dependency semantics and enlarge the application-owned output.

**Keep the named import and change TypeScript interop settings.** Type checking already accepted the source; the failure occurred in Electron's runtime ESM loader. Compiler flags would not make the CommonJS package expose a native named export.

**Keep the user's real home for smoke runs.** That would make a packaging check depend on existing profiles, credentials, and session state. An isolated home proves the supported first-run path and avoids mutating user data.

## Verification

The Electron package tests cover update behavior and distribution configuration. The source smoke starts the real Electron main entry on Windows, boots the web host from an empty temporary home, loads the browser UI, prints `ELECTRON_WINDOW_READY`, and exits successfully.

## Consequences

Fresh desktop launches no longer fail during module instantiation. Local and CI smoke runs exercise the same first-run home state, and window load failures become explicit instead of waiting for the outer timeout.
