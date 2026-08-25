# Agent Note: Model picker metadata hover card

Status: implemented

English | [中文](2026-08-24-model-picker-metadata-hover-card.zh.md)

## Problem

Model rows presented modality as individual outlined badges, which used scarce row space without explaining the exact route's id or advertised capacities.

## Decision

`session.models` now carries optional exact-route `contextWindow` and adapter-configured `maxTokens` beside the existing input modalities and reasoning metadata. The provider picker renders modalities as bare icons and uses the shared portaled `HoverCard` for each model row. The card presents model id, context, max output, and modality using only that Host metadata; absent values read as unknown.

## Alternatives considered

**Infer limits from a model name.** A name is not a provider promise and would show false precision for custom routes.

**Keep individual icon tooltips.** They duplicate the card's modality field while competing with the row-level hover target.

## Consequences

The session-model wire has two optional, validated positive token fields. The picker stays compact, and a longer dwell exposes exact details without affecting selection or prompt assembly. `api-proxy-models.spec.ts` verifies the wire projection, while `model-select.client.spec.tsx` verifies icon-only modalities and the hover-card values.
