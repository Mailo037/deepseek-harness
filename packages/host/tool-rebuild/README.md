# `@deepseek-ai/dsh-tool-rebuild`

English | [中文](README.zh.md)

Model-facing `rebuild_harness` tool for a web host running from a source checkout: the calling agent can rebuild the harness and restart the host without a human touching the terminal. One call stops the agent's running background jobs (`kill` plus a bounded wait per job), records each job's id, kind, label, and settled status in the logged tool result, and arms a restart for the calling turn's end — `whenIdle()`, so the result carrying the job record is in the session log before teardown. The restart itself reuses the [self-update](../self-update/README.md) machinery: `quiesceAgents()` cancels every live agent's turn (queued inbox work survives for the resumed sessions), `createWebUpdateHandoff({host, port}, {pull: false})` builds the detached helper, and the launcher's `ctx.appLifecycle.restart` hands off; the helper waits for the port, runs `pnpm run build`, and relaunches the same Web invocation with `--no-open`. After the restart the model resumes the session, reads the logged job list, and re-starts the jobs it owned.

Config: `jobStopTimeoutMs` (10 000) bounds one job's settlement wait; a job still live at the bound is recorded as is. The tool declares `timeoutMs` 30 000.

A deployment without the launcher's restart capability, without `ctx.selfUpdate`, or without the web server fails the call with the named missing capability; a deployment without `ctx.jobs` still rebuilds with an empty job record. The helper's relaunch reuses the original invocation's arguments, so a host started through `pnpm dsh:web` comes back with its `--profile web` and `--trusted-host` values; the build step is the repository's full `pnpm run build` (`build:lib` plus `build:web`), not the Android-facing `pnpm dsh:build`.

## Model Experience

### Tool schemas

#### What the model sees

The generated [`rebuild_harness` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-rebuild) while the tool is visible.

#### Token effect

Fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged.

### Rebuild result

#### What the model sees

One result block per call. It lists each stopped job as `<id> [<kind>] <label> -> <status>`, states whether the post-turn rebuild is scheduled, and — on a fresh schedule — instructs the model to restart the listed jobs after the restart before resuming other work.

#### Token effect

The block stays in parent history until compaction; a stopped-jobs list grows with the jobs the agent ran during the turn.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing entries.

## Known Limitations and Deferred Work

- **The browser overlay does not show tool-triggered rebuilds** — the GUI's update progress surface tracks only GUI-initiated applies; a tool rebuild appears to the browser as a disconnect until the new host binds.
- **Host-plane visibility is deliberate** — every web session's agent sees the tool because the restart is a process-wide fact, not a per-session capability; remove the row from the web bundle patch to take it away.
