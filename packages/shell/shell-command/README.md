# @deepseek-ai/dsh-shell-command

English | [中文](README.zh.md)

Executes human `!` shell commands against the composed `ctx.shell` capability seam and records the durable `shell/run`/`shell/done` lifecycle on the receiving session's log.

## Service contract

`ctx.shellCommand.run(agent, command, signal)` executes one `!`-prefixed composer line against the session's agent. The gateway resolves the wire session identity to the exact live `Agent`; the service trims the line after the leading `!`, validates it is non-empty, and runs it through `ctx.shell.resolve()`/`ctx.shell.run()` (or `ctx.shell.start()` in `tool` mode) — the same executor the model's bash/pwsh tools use, so the executor's configured timeout, output bounds, and environment handling apply unchanged. The command runs in the session's working directory (`agent.session.header.cwd` when present) under the session's resolved sandbox policy, exactly as the model's shell tools do.

The lifecycle is logged on the receiving agent's session as the log-only pair `shell/run` (before execution, with a minted `commandId`, the trimmed command, the issuing source, and the working directory when known) and `shell/done` (at settlement, with the outcome kind, structured `exitCode`/`signal`/`timedOut`, and the bounded merged stdout/stderr `output`). Both are direct standalone appends: no turn wraps them, and persistence drains them through ordinary checkpoints and teardown. An empty command settles as an error result without logging anything.

## Execution modes

The `mode` config selects how a `!` line is executed:

- `direct` (default): one-shot synchronous execution. The command runs to completion in the foreground and the result is reported to the agent as a single user message only after it settles. This is the historical behavior.
- `tool`: the command is launched immediately as an owned `ctx.jobs` background job and a user message describing the running job is delivered to the agent right away. The `run` RPC returns immediately (it never blocks on the command), and the machine can inspect, wait on, or stop the job through the model-facing `job_output`/`job_kill` tools over its lifetime. The `shell/done` card settles with the job's final process outcome, so the human UI terminal block is preserved and the settled output still reaches the model's next request.

`tool` mode requires a composed `ctx.jobs` registry (for example the `jobs-local` row) and fails loud at the `!` line if one is absent.

## Composition

The shipped `dsh web` bundle mounts this service (host plane) and the `ui-shell-command` client plugin, which registers the `!` input-trigger source and the `shell-command` chat node. The service requires a composed `ctx.shell` executor (the base's `bash-sandbox`/`pwsh-sandbox` rows); a composition without one fails at load.

## Model Experience

### Direct human shell commands

#### What the model sees

Nothing in `direct` mode. `!` lines are intercepted by the client's input-trigger source and executed in the shell command plane; neither the command text nor its output is submitted as a user message or otherwise reaches a model request at execution time — the settled command is reported as a user message afterwards. The `shell/run`/`shell/done` events are log-only and never surface to the model directly.

In `tool` mode the model sees, per `!` line, a user message naming the running background job (`job_output`/`job_kill` are available to inspect or stop it). The full command output reaches the model only if/when it reads the job.

#### Token effect

`direct` mode adds one user message per settled `!` line. `tool` mode adds one user message per launched job (the job-start notice).

#### KV Cache effect

Both modes add their per-command user message to the request cache; the command output itself enters the model request only when `job_output` reads the job.

## Known Limitations and Deferred Work

- **`direct` is one-shot foreground execution** — each `!` line runs in a fresh process; state (cwd, variables, functions) does not persist between commands.
- **`tool` hands the lifetime to the model's job controls** — the job runs in the background and its output is consumed through `job_output`, so a long-running command stays visible as a running card until it settles.
- **No streaming in `direct`** — output is captured and shown when the command settles; long-running commands appear as running until then.
