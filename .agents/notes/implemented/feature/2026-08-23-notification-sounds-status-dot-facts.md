# Agent Note: Notification sounds coupled to the status-dot session facts

Status: implemented

English | [中文](2026-08-23-notification-sounds-status-dot-facts.zh.md)

## Problem

A background session finishing (or failing) was visible only through the sidebar dot changing color. A user with the window unfocused had no signal that work completed, an interaction started blocking, or a turn ended in a terminal failure.

## Decision

New client plugin package `ui-notifications`: it owns a Host-backed opt-in preference (`enabled`, default false) plus per-event sound choices (`doneSound`/`attentionSound`/`errorSound`, each one of four built-in synthesized sounds). The settings row registers into `settings.general.item`; the master switch gates three per-event picker rows with preview buttons.

The watcher subscribes to the sessions list snapshot store — the same authority whose `SessionSummary` facts the workspace browser's status dots project — and derives transitions against the previously observed snapshot: a row's `attention` first appearing plays `error`, `pendingInteraction` first appearing plays `attention`, and a run stopping (or an idle row's first background job completing while nothing else needs handling) plays `done`. At most one sound plays per flush, priority error > attention > done. The baseline seeds silently, so boot and reconnect re-pulls never replay existing states; subagent-origin rows stay silent because their lifecycle surfaces through the parent's background activity.

Sounds are synthesized from Web Audio oscillators and gain envelopes, so no audio assets ship with the bundle; a missing or suspended `AudioContext` degrades to silence instead of throwing.

## Alternatives considered

**Deriving events inside ui-workspace's tree derivation.** Rejected: that derivation is render-scoped (folded groups skip row projection), would miss exactly the background sessions notifications exist for, and sound output is not presentation state.

**Browser desktop notifications.** Deferred: they need a permission flow and per-OS presentation; sounds already cover the window-open-but-unfocused case. Recorded under the package README's known limitations.

## Consequences

Completion, blocking interactions, and failures now have an audible cue once the user opts in. The event vocabulary mirrors the dot states one-to-one, giving future dot states an obvious place to add their sound. Package tests pin the transition rules, per-flush priority, baseline seeding, write routing through the settings scope, and the synthesized voices' counts.
