# Agent Note: Background-job mode for `!` human shell commands

Status: implemented

English | [中文](2026-08-21-shell-command-background-job-mode.zh.md)

## Problem

Every `!`-prefixed composer line was executed synchronously in the foreground: the `ctx.shellCommand.run` RPC blocked on the shell command, and
the result reached the agent only after the command settled. The machine saw nothing until the command was finished — it could not inspect, wait on, or
stop a running `!` command. Long-running commands blocked the browser RPC and left the UI terminal card in a "running" state for the entire duration.

## Decision

Add a `mode` config to `@deepseek-ai/dsh-shell-command` with two values:

- `direct` (default): the historical synchronous foreground execution. The command runs to completion, the `shell/done` card settles, and a user
  message with the final output is delivered to the agent afterwards.
- `tool`: the command is launched as an owned `ctx.jobs` background job immediately. The `run` RPC returns at once (it never blocks), and the agent
  receives a user message naming the running job id (`job_output`/`job_kill` are available to inspect or stop it). The `shell/done` card settles
  when the job finishes, preserving the terminal block UI.

### Why not a synthetic tool-call in the agent loop

The original design called for injecting a synthetic `assistant/message` with a `tool-call` block plus `tool/call`/`tool/result` events into the
session log, so the machine would see a bash `run_in_background: true` tool call as if it had issued it itself. That approach was rejected during
implementation because:

1. **Session invariant violation.** The `assistant/message`, `tool/call`, and `tool/result` event types require an open `turn/step` boundary
   (`requireOpenStep` in the session invariant). Appending them from a standalone host service outside any turn would mark the session as corrupt.
2. **Core-loop integration required.** To stay invariant-compliant the events would have to be written from inside the `step()` loop of the agent
   loop, which would require a new external-tool-call channel on the agent and a drain point in the loop — a deep, invasive change to
   `@deepseek-ai/dsh-agent-loop` with substantial testing and documentation overhead.
3. **The background-job path achieves the same user-facing goal.** The machine sees a user message naming the running job, can call
   `job_output`/`job_kill` to inspect or stop it, and the browser RPC never blocks. The `shell/done` card still settles with the final outcome,
   and the settled output reaches the model's next request through `deriveMessages`.

### Mode defaults

The default is `direct` for backward compatibility. Deployments that want the non-blocking, machine-controllable behaviour opt in by setting
`mode: 'tool'` in the `shell-command` entry's config.

## Verification

- [`packages/shell/shell-command/tests/shell-command.spec.ts`](../../../../packages/shell/shell-command/tests/shell-command.spec.ts) passes
  9 tests covering both `direct` and `tool` modes: admission, shell lifecycle, session working directory, empty-command rejection, stderr merging,
  timeout rendering, and the tool-mode background job registration, immediate RPC return, and agent notification.
- TypeScript compilation (`tsc --noEmit`) passes on the `@deepseek-ai/dsh-shell-command` package.

## Alternatives considered

**Synthetic tool-call lifecycle authored by the host service.** Rejected (see above) — the session invariant requires an open turn/step, and
faking one from outside the loop would corrupt the log.

**Synthetic turn/step boundary opened by the host service.** Opening `turn/start`/`step/start` from the host service, writing the tool-call
events, and closing the boundary would satisfy the invariant, but turn/step numbering must match the agent loop's monotonic sequence, and a
host-opened boundary would produce a "hollow" turn that the agent loop never owned — a new class of log state with no precedent, no replay
guarantee, and no tested teardown path.

**Delegating to `ctx.tools.execute` with `run_in_background`.** The `tool-bash`/`tool-pwsh` tools are registered in agent-scoped contexts
(preset realms) and may not be visible from the host-plane `shell-command` service. The background-job path (`ctx.jobs` + `ctx.shell.start`)
is host-plane-safe and avoids the visibility question.

## Consequences

- `@deepseek-ai/dsh-shell-command` gains a new peer dependency on `@deepseek-ai/dsh-jobs` (the `JobRegistry` interface) and the `tsconfig`
  references `../../jobs/jobs`.
- The `shell-command` entry in `cordis.patch.yml` can now accept a `config.mode` field.
- An existing deployment that upgrades and leaves `mode` unset keeps the historical `direct` behaviour.
- In `tool` mode the machine sees one extra user message per `!` line plus the `shell/done` card output; the token cost of the command output
  itself is deferred until the machine reads the job.
- The `shell/done` card in `tool` mode carries only the exit status pill (no full output text); the full output is available through
  `job_output`.
- The `tool` mode requires a composed `ctx.jobs` registry (e.g. `@deepseek-ai/dsh-jobs-local`) and fails loud at the `!` line if one is absent.
- Future work could default the Web bundle to `mode: 'tool'` once the background-job display is well established, making `!` commands
  non-blocking by default.