# Agent Note: Queued image thumbnails

Status: implemented

English | [中文](2026-08-24-queued-image-thumbnails.zh.md)

## Problem

QueueDock flattened image blocks into the literal `[image]` marker, although a queued message already carries the attachment reference required for a preview.

## Decision

QueueDock keeps the QueueMirror preview's text budget and renders each image block at its original content position as a 24px thumbnail. It resolves the `ImageAttachmentRef` through `ConversationController.resolveImage`; a loading or failed attachment shows the existing neutral image glyph instead of marker text. Text-only and other non-image previews keep their current rendering.

## Alternatives considered

**Keep a permanent image glyph.** A generic glyph identifies the media kind but gives no usable visual cue for the queued image.

**Embed the submitted Base64 data.** Queue rows use the host-owned attachment reference, whose loader keeps image access scoped to the rendered session and shares the existing URL cache.

**Add a richer queue-wire preview.** The current queue content already records block order and attachment identity, so the dock can make this presentation change without expanding the runtime projection.

## Consequences

Image-bearing queue rows load their thumbnails asynchronously without changing their queue actions, editing rule, or authoritative ordering. `queue-dock.client.spec.tsx` verifies the resolved thumbnail replaces marker text, while the mixed-content test keeps the non-text edit restriction pinned.
