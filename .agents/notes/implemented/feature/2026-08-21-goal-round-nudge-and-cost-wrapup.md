# Agent Note: Goal-round nudge, bounded error retry, and cost wrap-up

Status: implemented

English | [中文](2026-08-21-goal-round-nudge-and-cost-wrapup.zh.md)

## Problem

An armed goal was driven only by events. A round that errored disarmed the goal and required a later human `resume`, so a transient provider or persistence blip stalled an otherwise legitimate autonomous objective; and because every trigger was an event, an idle agent whose goal had become armed without a subsequent goal change or turn transition could sit quiescent indefinitely with no pending reservation. Separately, when the model finally reported `complete` or `blocked`, the closing message had no grounding about the whole goal's cost — how many tokens it consumed and how long it ran.

## Decision

The [goal-round driver](2026-07-19-same-session-goal-round-driver.md) and [model-facing goal tools](2026-07-19-model-facing-goal-tools.md) gain three behaviors. All are opt-in via new configuration on the driver.

### Periodic nudge

The driver installs a process-local `setInterval` (`nudgeIntervalMs`, default `30000`) inside its single composite Cordis effect. Each tick walks the live `states` map and calls `requestDrive(state)` for any agent whose current goal is `active` and `armed`, whose status is `idle`, and which has no competing queued work. `drive()` rechecks every quiescence predicate and the durable goal itself, so a completed, paused, blocked, disarmed, or capped goal is a no-op and a concurrent ordinary prompt still yields. The interval is cleared first during teardown. Because the driver is otherwise fully event-driven, this timer is a defensive redundancy, not the primary turn source: no model-visible prompt or session event is unique to it.

### Consecutive-error retry and block

The `agent/error` boundary no longer unconditionally disarms. When the error belongs to a round whose reservation is `claimed` or `admitted` and the goal is still `active`/`armed`, the driver increments a per-agent `consecutiveErrors` counter and leaves continuation armed so the next idle checkpoint or nudge re-queues the same next round. When that counter reaches `consecutiveErrorLimit` (default `5`) it blocks the goal with code `repeated-error`, message `Goal rounds failed N consecutive times; last error: <error>`. A successful turn/end, any `goal/changed`, and a `session-start` reset the counter to zero.

A failure not attributable to an admitted round (a human turn, or a round that only reached `queued`) still disarms, matching the old behavior. This deliberately supersedes the earlier "no abnormal outcome requests an automatic retry" rule from the driver note: transient provider errors are now retried automatically, bounded by `consecutiveErrorLimit`. Rate limits, provider auth failures, and persistence failures are deliberately not classified — a broken loop exhausts the counter into `repeated-error` instead of burning the whole `maxGoalRounds` budget, and the blind-retry limitation is documented in the package README.

### Whole-goal cost wrap-up

When an autonomous goal round reports `complete` or `blocked`, `dsh-tool-goal` now derives whole-goal cost from the owning session log and renders it into the deferred closing-message block (`wrapup.ts`). `goalWrapupStats(agent, goal)` sums provider-reported `assistant/message` usage (`inputTokens + outputTokens + cacheRead + cacheWrite`) across every step after the goal's create mutation, and reports `elapsedMs` since `goal.createdAt`. If no step reported usage the token number is omitted. The wrap-up block gains a resource line the model is told to repeat once in its closing message, e.g. `The whole goal took 2m 5s and consumed 1,240 tokens. State both numbers once in your closing message.` The compact tool result value is unchanged.

## Alternatives considered

- **Keep all errors disarming** — rejected because it made a transient provider blip stall an autonomous objective behind a mandatory human `resume`, which is the problem this note sets out to fix; the retry is bounded so an unrecoverable loop cannot exhaust the round budget silently.
- **Classify failures (rate limit vs auth vs persistence) before retrying** — rejected because the driver has no reliable classifier and classifying would couple it to provider semantics; counting every admitted-round failure with a hard cap is simpler and safe, and an independent resource policy remains deferred.
- **Make the nudge a strict watchdog that disarms on total inactivity** — rejected because the goal already has an explicit round cap and a `consecutiveErrorLimit`; adding a wall-clock inactivity timeout would be a third, redundant stop policy.
- **Persist the consecutive-error counter or the token/time totals** — rejected because the counter is only scheduling state (process-local like activation) and the cost figures are derived, lossless, and replayable from the session log; persisting either would add durable schema for disposable data.

## Consequences

- A transient round error retries automatically at the next idle checkpoint or nudge, up to `consecutiveErrorLimit`; the goal blocks `repeated-error` once the cap is exceeded, matching "fail loud, never hidden budget burn."
- The driver now carries two configurable tunables (`nudgeIntervalMs`, `consecutiveErrorLimit`), so the earlier "plugin has no configuration" claim in the [driver note](2026-07-19-same-session-goal-round-driver.md) no longer holds there; this note supersedes that part and the new values live in this note and the package README.
- The closing message after completion or blocking is grounded with the whole-goal elapsed time and, when the provider reports usage, the token total, so the model (and the user) get a concrete cost summary without a separate accounting UI.
- Retries are blind: every admitted-round failure counts, so a persistent provider outage reaches `repeated-error` after `consecutiveErrorLimit` rounds rather than retrying forever or disarming silently.

## Testing

The driver unit suite covers the new retry path (a transient error then success reaching `round-limit`; consecutive errors blocking `repeated-error`; a turn/end failure blocking `repeated-error` after the configured count), the disarm boundary for a non-round failure, the round-cap block after a failed round, and the interval nudge progressing an idle armed goal under fake timers. The tool-goal suite asserts the wrap-up block names elapsed time and the summed token total (240 for a 120/80/40 usage event) and tells the model to state both numbers once. All other goal, command-goal, and invariant suites pass unchanged.
