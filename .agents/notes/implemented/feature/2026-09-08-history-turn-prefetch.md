# Agent Note: Collapsed history turns with delayed prefix prefetch

Status: implemented

English | [中文](2026-09-08-history-turn-prefetch.zh.md)

## Problem

A message-aligned history page can omit the beginning of a completed turn. Waiting for the reader to scroll through its work before showing the duration fold makes the transcript collapse after several pagination requests.

## Decision

The history response includes the logged bounds of a completed turn whose work precedes the page. The browser retains that metadata independently of its contiguous event window and renders the duration fold immediately. Each successful page schedules another prefix read after the configurable reading pause until the turn start arrives. Expanding starts the next read immediately. The group retains its identity and disclosure state after backfill; failed reads remain retryable without an automatic retry loop.

The [log-ordered transcript decision](../../implemented/bug-fix/2026-07-30-web-transcript-log-ordered-projection.md) continues to own event ordering and compaction rendering. Timing metadata does not synthesize log events or introduce gaps into the assembler.

## Alternatives considered

**Loading every session event before showing history** delays the initial transcript and scales with the entire log.

**Sparse summaries with independently fetched detail ranges** require a second event-window representation and reconciliation with live events. Contiguous prefix reads reuse the established assembler and transport while hiding intermediate work behind its final group.

## Consequences

The initial page remains small, and hidden work becomes available without repeated scrolling. A prefix page can also include earlier turns because pagination remains message-based. The host still reads the session cut to locate turn bounds. A turn encountered through a partial page remains folded even if it is below the ordinary ten-action threshold. Running turns retain their streaming presentation.

Focused host, runtime, and component tests cover timing, prefix completion, cancellation, and disclosure continuity. The keyless browser scenario seeds sixty steps and checks multi-page backfill and the collapsed transcript snapshot.

The composer file-change disclosure also tolerates a received statistics projection without `fileChanges`, using loaded-turn changes until a complete projection arrives. Projection payloads are not domain-validated in the client store, so a running Host and refreshed browser can otherwise crash the dock during development updates. Its regression test covers the incomplete-to-complete transition.
