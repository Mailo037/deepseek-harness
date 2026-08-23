# Agent Note: Reconnect overlay grace period

Status: implemented

English | [中文](2026-08-22-reconnect-overlay-grace-period.zh.md)

## Problem

The full-screen connection-loss overlay appeared as soon as the connection entered reconnecting state. A transient disconnect could therefore replace the application for only a moment and create a visible flash even though recovery succeeded immediately.

## Decision

`ConnectionLostOverlay` waits until reconnecting has remained true continuously for one second. Reconnection still begins immediately; only the full-screen presentation is delayed. Recovery before the timer expires cancels the pending overlay, and recovery after it appears hides it immediately.

The delay belongs to the presentation primitive rather than the connection service, so state subscribers and resynchronization retain the original timing.

## Alternatives considered

**Delay the reconnecting state.** This would also delay non-visual consumers and could postpone resynchronization work, so the connection service continues to publish state immediately.

**Animate or shorten the immediate overlay.** Any immediate full-screen replacement can still flash during a short disconnect, so animation does not remove the underlying interruption.

## Consequences

Disconnects shorter than one second no longer cover the application. A sustained outage communicates its state one second later than before, while recovery remains immediate.

Fake-timer component and assembled-layout tests pin the grace period, cancellation, sustained-outage display, and immediate recovery behavior. No model-visible input changes, so no transcript snapshot changes.
