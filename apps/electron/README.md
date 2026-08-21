# @deepseek-ai/dsh-electron

English | [中文](README.zh.md)

The DeepSeek Harness desktop app: the same browser UI `dsh web` serves, running inside an [Electron](https://www.electronjs.org/) window, with an app-level close grace so agent work is not cut off the moment the window closes.

## Why this exists

In the plain web setup (`dsh web`), the browser tab is a view over a host process that keeps running when the tab closes — agent work is not tied to the page. A desktop app changes that expectation: users close the window to close the app, and a window close is usually also an app close. `dsh-electron` keeps the host alive for a short grace window after the last window closes, so a quick reopen resumes exactly where the run was, and a real shutdown flushes sessions cleanly instead of killing the host mid-step.

## Architecture

```
Electron main process
├── bootWebHost()          the same web-profile stack `dsh web` boots,
│                          composed through @deepseek-ai/dsh-app-boot
│                          (bundles → profile layer → home layer)
├── BrowserWindow          loads http://127.0.0.1:<os-assigned port>
│                          (contextIsolation, sandbox, no nodeIntegration)
└── GraceTimer             window-all-closed → GRACE_MS → shutdown + quit
                           second-instance → cancel grace, recreate window
```

- The host (agent runtime) lives in the **main** process, never in the renderer. A renderer crash reloads the window; agent work keeps running.
- The app takes an **OS-assigned port** (`--port 0`), so it never collides with a `dsh web` instance on 3080.
- Sessions, settings, credentials, and the `web` profile under `$DSH_HOME` are shared with `dsh web` — the same chats appear in both.
- A `DSH_ELECTRON_GRACE_MS` environment variable overrides the 5-second default.

## Run

```sh
pnpm run build          # builds packages + this app's lib/
pnpm run dev:electron   # tsc -b && electron .
```

The desktop app needs a built frontend dist (`apps/web/dist`), which the repository build produces.

## Lifecycle contract

| Event | Behavior |
|---|---|
| Last window closed | Start grace timer (`DSH_ELECTRON_GRACE_MS`, default 5000 ms). The host keeps working during the window. |
| App reopened within grace (second instance) | Grace cancelled, window recreated, agent work never stopped. |
| Grace expires | Host shuts down (sessions flush, persistence closes), app quits. |
| Explicit quit (menu/OS) | Host shuts down immediately, then quits. |
| Renderer crash | Window reloads; host keeps running. |

## Test

```sh
pnpm --filter @deepseek-ai/dsh-electron run test
```

The host smoke test boots the real web profile in a plain-Node subprocess (the same boot path the Electron main uses, minus Electron), asserts the served page carries `window.__DSH_BOOT__`, and verifies the clean-shutdown path.

## Known Limitations and Deferred Work

- **Packaging** (electron-builder installers, code signing, auto-update) is not wired up yet; the app runs from the repository via `pnpm run dev:electron`.
- **Per-chat processes** are not implemented: all sessions run in one host process in the Electron main. The grace window protects against window close; a hard kill of the whole process still ends the host (sessions are persisted, so chats resume from their last checkpoint on the next launch).
- **macOS** keeps the app alive after the last window closes by platform convention; the grace timer does not fire there.
- **No tray icon**: while every window is closed during the grace window, the app is only reachable by relaunching it (single-instance lock routes to the running instance).
