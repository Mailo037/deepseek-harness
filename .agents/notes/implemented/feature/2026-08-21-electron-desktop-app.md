# Agent Note: Electron desktop app (`dsh-electron`)

Status: implemented

English | [中文](2026-08-21-electron-desktop-app.zh.md)

## Problem

The DeepSeek Harness Web UI (`dsh web`) runs in a browser tab, and closing the tab does not affect the host process — agent work continues independently. A desktop app changes that expectation: users close the window expecting the app to quit, and a hard process kill while the agent is mid-step loses the current request. The repo had no Electron packaging, no desktop lifecycle, and no grace window between window close and process exit.

## Decision

A new `apps/electron` package ships the desktop app. `apps/electron/src/host.ts` boots the same `web` profile as `dsh web` through `@deepseek-ai/dsh-app-boot` (loadProfile, composeEntries, boot, watchUserPatches), without the CLI launcher's signal handling and process-exit infrastructure. The booted host runs in the Electron main process, so the agent runtime lives in the same process as the window shell — a renderer crash reloads the window but does not interrupt agent work.

The Electron main (`src/index.ts`) owns:

- **Single-instance lock** — `app.requestSingleInstanceLock()`; a second launch routes to the running instance via `second-instance`.
- **Close grace** — `window-all-closed` (non-darwin) arms a `GraceTimer` (default 5000 ms). During the grace the host keeps running, so agents continue working. If the user reopens the app (second-instance) within the window, the grace is cancelled and the window is recreated — agent work was never interrupted. If the grace expires, the host shuts down (sessions flush) and the app quits.
- **Explicit quit** — `before-quit` shuts the host down immediately.
- **Renderer crash** — `render-process-gone` reloads the window; the host is unaffected because it lives in the main process.

`src/grace.ts` is a pure-Node `GraceTimer` (start/cancel/fire/dispose) with no Electron dependency, tested with fake timers.

`src/smoke.ts` is a plain-Node entry that boots the host and prints `ELECTRON_HOST_READY <url>`, then shuts down on stdin `q` or EOF. The host smoke test (`tests/host.spec.ts`) spawns this entry in a subprocess with a throwaway `$DSH_HOME`, asserts the served page carries `window.__DSH_BOOT__`, and verifies the exit code is 0 on clean shutdown.

The app uses an OS-assigned port (`--port 0`) so it never collides with a `dsh web` instance on 3080. Settings, credentials, sessions, and the `web` profile under `$DSH_HOME` are shared with `dsh web` — the same chats appear in both.

## Alternatives considered

**Electron as a thin wrapper spawning `dsh web` as a child process.** Rejected for the first version: the host survives the main process when the window is closed, but a hard parent crash leaves a verwaist host running forever, and on Windows child-process signals are not available for graceful shutdown. In-process boot gives deterministic lifecycle control and clean shutdown via `ctx.fiber.dispose()`.

**Per-chat worker processes.** The original request was for each chat session to run in its own OS process, surviving the app close for 5 seconds. This is deferred: the agent loop runs in-process today, and moving each session to a worker thread or process is a larger architectural change. The app-level grace on `window-all-closed` protects the most common "close the window" case, and session persistence (`$DSH_HOME/sessions`) recovers chats on the next launch after a hard crash.

## Consequences

The desktop app is usable from the repository (`pnpm run dev:electron`). The 5-second grace gives agents time to finish the current step after the last window is closed, and a quick reopen resumes without interruption. On a hard crash or SIGKILL, sessions are persisted through the checkpoint policy and the next launch shows the same chats.

`apps/electron` carries the same dependency closure as `apps/cli` (all `@deepseek-ai/dsh-*` workspace packages) so `healProfilesModuleFallback` can link the full plugin tree into `$DSH_HOME/profiles/node_modules`. The Electron binary is a devDependency (`pnpm install` downloads ~100 MB).

## Testing

- `tests/grace.spec.ts` — `GraceTimer` with fake timers: fires after the configured window, does not fire after cancel, replaces an earlier timer on re-start, fires immediately on `fire()`.
- `tests/host.spec.ts` — spawns `lib/types/smoke.js` in a plain-Node subprocess with a throwaway `$DSH_HOME`, asserts the ready line, the served page (`window.__DSH_BOOT__`), and exit code 0 on clean shutdown. Timeout: 90 s.
- The Electron smoke mode (`DSH_ELECTRON_SMOKE=1`) opens the window, waits for `did-finish-load`, logs `ELECTRON_WINDOW_READY`, and exits — proven on Windows via the actual Electron binary.