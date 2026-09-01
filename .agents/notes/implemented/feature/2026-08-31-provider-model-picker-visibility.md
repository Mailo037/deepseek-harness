# Agent Note: Provider model-picker visibility is independent of routing

Status: implemented

English | [中文](2026-08-31-provider-model-picker-visibility.zh.md)

## Problem

Configured providers can accumulate a large catalog, while a user may want to keep a route available for existing sessions or explicit configuration without offering all of its models in the ordinary picker.

## Decision

The Models settings namespace stores `hiddenProviders` beside `providerOrder`. Each configured provider row exposes a **Show in model picker** checkbox. The host api-proxy excludes stored route ids only while assembling `session.models` and `llm.models`; it leaves `llm.providers`, the adapter registry, direct selections, and logged session selections unchanged. An absent list resolves to an empty list, so every existing provider remains visible.

## Alternatives considered

**Disable or remove the provider.** Rejected because that also changes routing and can break saved or explicit selections.

**Hide models only in the React component.** Rejected because the command picker and composer would diverge, and every client would still receive catalogs the user excluded.

## Consequences

The checkbox persists a presentation preference and refreshes the existing Models join. A provider hidden from the catalog can still be selected by a saved session or direct configuration, but it is no longer offered in either Host catalog response.

## Testing

Focused component coverage pins the settings write, host-schema coverage pins the empty default, and api-proxy coverage pins that catalog filtering does not change `llm.providers`.
