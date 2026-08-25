# Agent Note: Mandatory-reasoning effort escalation

Status: implemented

English | [中文](2026-08-25-mandatory-reasoning-effort-escalation.zh.md)

## Problem

Some OpenAI-compatible gateways in front of thinking models reject every request that disables or omits reasoning, answering with an HTTP 400 whose message reads "Reasoning is mandatory for this endpoint and cannot be disabled". The `dsh-llm-deepseek` adapter serializes a configured or per-request effort of `off` as `thinking: {type: 'disabled'}`, so against such an endpoint every conversation turn failed with the raw provider error and the only fix was a manual settings change — after the user had already seen the failure.

## Decision

Inside one `stream()` call, when a non-ok chat response's provider detail reports reasoning as mandatory or undisablable (regex family over "reasoning … mandatory/required", "mandatory/required … reasoning", and "reasoning … cannot be disabled"), the adapter escalates the effort one ladder step and rebuilds the request body in place: the first rejection retries at `low`, the second at `high`, the third at `max`. The failed attempt's own wire `reasoning_effort` selects the next step (`undefined → low → high → max`), so a request already carrying `max` fails without retrying. At most three retries happen; after the ladder is exhausted the original provider error surfaces unchanged. Escalation is skipped for `purpose: 'session-title'`, which keeps its reserved non-thinking output budget. A deployment locked to `thinking: disabled` does not silently override its lock: serializing an escalated enabled effort throws `UNSUPPORTED_REASONING_EFFORT`, failing loudly on the first escalation attempt. The override is per-call state — it never mutates the logged call config, so the session log still records the effort the caller asked for while the wire carries the escalated value.

## Alternatives considered

**Retry at the agent-loop or `agent/request` level.** Rejected: the loop would re-run a full turn for what is a transport-shaped retry, and the call config is deliberately not a silently-adjustable per-call knob. The adapter already owns the same pattern — stale-file recovery rebuilds and resends within `request()` — so escalation lives there too.

**Treat the error as a static misconfiguration and refuse.** Rejected as the only behavior: whether an endpoint mandates reasoning is a deployment property the harness cannot discover before I/O, and the user-facing ask is recovery, not diagnosis. The lock case keeps fail-loud semantics where a lock exists.

## Consequences

A gateway that mandates reasoning now succeeds from an `off` default within one stream call, paying up to three extra HTTP requests on the first turn only. The detection is textual, like the existing stale-file and normalized-image matchers, so an unrelated error containing those phrases could trigger an escalation before ultimately surfacing the same error. `packages/llm/llm-deepseek/tests/adapter.spec.ts` pins the ladder (off → low → high → max), ladder exhaustion with the original error preserved, the no-retry-at-max case, and non-escalation for unrelated 400s.
