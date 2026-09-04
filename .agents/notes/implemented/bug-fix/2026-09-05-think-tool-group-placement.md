# Agent Note: Keep assistant reasoning inside its tool group

Status: implemented

English | [中文](2026-09-05-think-tool-group-placement.zh.md)

## Problem

A mixed assistant step contains reasoning and answer content. Grouping the entire step by its visible text places its Think disclosure outside the preceding tool group when the first answer token arrives. The mutable node store also retains its identity across deltas, so reading it without selecting placement changes can leave an initially empty streaming step outside the group.

## Decision

The chat view renders non-interrupted reasoning through a node-local reasoning component inside the adjacent work run. Mixed steps render their text and images through the existing assistant slot with reasoning omitted. The reasoning component keeps its identity across the first answer token and has a distinct scroll anchor. Interrupted steps remain in the normal flow with their stopped marker.

The parent selects reasoning placement and run activity as primitive values from the framework session hook. Text-only deltas leave this selection unchanged; each node component observes its own content. Manual collapse remains owned by the existing tool group.

## Alternatives considered

**Move the whole step into the group.** This hides answer text and attachments with tool activity.

**Rebuild the flow on every node delta.** This adds whole-list work during streaming even when placement and activity stay unchanged.

## Consequences

Think disclosures stay with tool activity while answer content remains readable independently. Component regressions cover empty-to-reasoning streaming, mixed output, disclosure identity, manual collapse, and cold settled rendering. The Web regression replays the recorded question-composer conversation through the real composition and snapshots both grouped reasoning summaries. No session event or model request changes.
