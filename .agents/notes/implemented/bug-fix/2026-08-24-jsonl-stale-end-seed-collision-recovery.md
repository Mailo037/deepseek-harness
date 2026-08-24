# Agent Note: JSONL stale end-seed collision recovery

Status: implemented

English | [中文](2026-08-24-jsonl-stale-end-seed-collision-recovery.zh.md)

## Problem

JSONL coordinates writes only inside one backend instance. A seeded pickup appends a log-only `session/end-seed` event at the stored length, while another process that still owns the same Session can append a user-visible lifecycle event at that seq. The two individually contiguous writers then leave one adjacent duplicate: the marker first, the active lifecycle second. Strict scanning rejects the later committed turn, so one technical marker makes the whole conversation unavailable even though removing it restores a single contiguous event stream.

The pattern is narrower than general concurrent-write corruption. The colliding first event is always `session/end-seed`, it has no model or surface content, the next event repeats exactly its seq, and every retained event still satisfies `events[i].seq === i`. No other duplicate or gap proves which writer's branch is authoritative.

## Decision

`SessionLogScanner` treats exactly one physical pattern as recoverable: when the event immediately before a seq conflict is `session/end-seed` and the candidate repeats that marker's seq, the scanner removes the marker and accepts the candidate at the now-current length. The active lifecycle and every later event retain their recorded seq and time. The scanner applies the rule to raw and Zstandard logs because both encodings share it.

Every other seq mismatch keeps the existing corruption behavior. In particular, the scanner does not renumber events, choose between two content-bearing events, search backward for a marker, or tolerate a gap after the recovery.

The stored artifact remains append-only. Recovery is a logical read rule rather than an automatic rewrite, so opening history does not mutate or replace user data. A later append continues from the recovered logical event count.

## Alternatives considered

**Reject every committed duplicate.** This preserves the simplest storage invariant but makes an otherwise contiguous conversation unavailable because of a marker whose only purpose is lifecycle classification. It discards the stronger evidence supplied by the adjacent active lifecycle.

**Renumber the active writer's suffix.** This changes durable event identities, `sourceEventSeqs`, and any external correlation keyed by `(session id, seq)`. It also requires rewriting compressed history and cannot be justified when a content-free marker is the sole conflicting event.

**Accept arbitrary duplicate seq values.** Two content-bearing branches have no safe automatic winner. Broad tolerance would turn detectable corruption into silent history loss, so the exception stays tied to the unique log-only marker and immediate adjacency.

**Add cross-process writer leasing in the same change.** A lease prevents future collisions but does not make existing logs readable, and crash-safe ownership needs its own lifecycle, stale-owner, and multi-platform design. JSONL continues to document one live writer per session; this decision only recovers the proven marker collision without claiming multi-process safety.

## Verification

Scanner coverage commits a complete turn, a stale end-seed marker, and a second complete lifecycle beginning at the same seq. It requires the marker to disappear, the lifecycle to remain contiguous, and the committed byte cursor to reach the artifact end. A negative control replaces the marker with an ordinary duplicate and requires the existing committed-region corruption error.

## Consequences

Conversations carrying this exact collision load without data renumbering or a storage rewrite. Raw export still exposes the physical marker because it promises exact artifact bytes, while logical history omits it. General concurrent JSONL writers remain unsupported and every ambiguous mismatch still fails loudly.
