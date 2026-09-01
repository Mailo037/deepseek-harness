# Agent Note: The model rebuilds its own web host (`rebuild_harness`)

Status: implemented

English | [中文](2026-08-27-tool-triggered-harness-rebuild.zh.md)

## Problem

An agent working on the harness inside the web GUI could not apply its own source changes: rebuilding and restarting the host was a human terminal task, and doing it while sessions ran killed background jobs without a record of what was running. The existing self-update flow (`host.applyUpdate`) is browser-facing, always fast-forwards to upstream, and never reaches a model request, so the model had no way to say "rebuild what is on disk and come back".

## Decision

The model rebuilds and restarts its own web host through one tool, `rebuild_harness` (`@deepseek-ai/dsh-tool-rebuild`), which composes three existing pieces instead of a new restart mechanism: the job registry for safe job termination, the self-update service for agent quiescence and the detached helper, and the launcher's `ctx.appLifecycle.restart` for the process handoff. The helper gains a `pull: false` plan flag (`createWebUpdateHandoff(address, { pull: false })`) so the same runner serves both upstream updates and rebuild-only restarts; the build stays in the helper because the running host must exit before `pnpm run build` may replace the artifacts it is executing from.

The restart is armed by the tool but fires from the calling agent's `whenIdle()`, never inside `execute()`. This ordering is what makes the job record durable: the tool kills its owner's running jobs, waits each settlement out (bounded by `jobStopTimeoutMs`), and returns them in the canonical result; the turn then ends, logging the `tool/result`, and only the idle callback quiesces every agent (`quiesceAgents`, inbox kept) and hands off. A restart inside `execute()` would cancel the turn carrying the record it exists to preserve.

Job re-drive after the restart is transcript-mediated, not a new runtime mechanism: the logged result lists every stopped job and instructs the model to restart them, so a resumed session replays the instruction as ordinary history. The tool mounts host-plane in the `dsh-web-app` bundle (every web session's agent sees it) because a process restart is process-wide; it fails the call — not the load — on a host without the restart capability, `ctx.selfUpdate`, or `ctx.webServer`.

## Alternatives considered

- **Restarting inside `execute()`** would make the tool self-contained but destroys its own result: the turn is cancelled mid-flight, the job list never reaches the log, and the model resumes blind. The idle-arm ordering is the whole design.
- **A dedicated durable "pending jobs" store** (new session event or file) was rejected because the logged tool result already is the durable record the model reads; a second store would duplicate it and need its own replay story.
- **Extending `host.applyUpdate` to the model** would couple the model to a git pull it did not ask for; the user's flow is "rebuild what is on disk", so the tool pins `pull: false`.

## Consequences

- A tool-triggered rebuild shows the browser only a disconnect: the GUI's update overlay tracks GUI-initiated applies via the update store, and the tool path deliberately bypasses it. Documented in the package README rather than extended.
- Unowned and other owners' jobs are not enumerated by the tool (owner-fenced access is the registry's boundary); they still end safely through agent quiescence and registry disposal, but they are absent from the durable record — only the calling agent gets its jobs re-driven.
- `verify-cordis-config` keeps the bundle honest: the new row's package is a `dsh-web-app` dependency.
