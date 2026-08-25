# Agent Note: provider display order

Status: implemented

English | [中文](2026-08-25-provider-display-order.zh.md)

> Scope: the user-arranged provider order for the Models settings page and the model selector, extending the [web configuration plane](2026-07-30-web-config-plane.md) with one durable preference and its host-side application.

## Problem

Provider order on the Models settings page followed the configurable-provider directory declaration order, and the model selector's groups followed adapter registration order — two natural orders no user could change. The page offered no way to arrange the providers a user actually uses, and the selector surfaced whichever adapter registered first. Any user preference needs one durable home, and both surfaces must read the same order so "arrange here" and "shown there" cannot drift.

## Decision

**The Models settings plugin owns a `models` settings namespace carrying `providerOrder` (provider route ids, first = top).** Its node half registers the namespace through `ctx.inject(['settings'], …)` with a schemastery schema (`z.object({ providerOrder: z.array(z.string()) })`); the namespace name is the wire contract the page and the host read it by, exactly as client settings writes address namespaces by name.

**The host applies the preference at the two assembly points, not the browser.** `api-proxy` sorts `llm.providers` views and `buildModelCatalog` groups (`session.models` and `llm.models` share the latter) by `sortByProviderPreference`: listed ids first in preference order, everything else appended in its natural relative order. Sorting in the host keeps the settings mirror, the settings page rows, and the composer's model menu on one order without teaching two client packages a second fact source.

**The Models page renders a grip handle per row card.** The collapsed row card is the drag source (matching the sidebar session rows), and chevron insert markers above or below the hovered row show where the row will land; ArrowUp/ArrowDown on the handle moves the same way for keyboard users — the established QueueDock gesture. An open editor keeps the row non-draggable so its text inputs stay selectable, but the handle still initiates a drag from the grip icon. Every move persists the full visible row-card id sequence through `settings.update` with the namespace's current revision, then reloads the join; a rejected write surfaces as an alert line and leaves the rows where they were. Setup cards (the first-run posture) are not drag targets, and a read-only settings document disables the handles.

## Alternatives considered

- **Client-side ordering in both surfaces** — each surface would re-sort its wire echo, duplicating the preference read in `ui-settings-models` and `ui-model-selection` and making the wire order meaningless. The host is the single fact source for both, so the preference is applied where the responses are assembled.
- **A provider field on each profile** (a per-profile `order` number) — ordering would be scattered across provider namespaces, and a new provider's position would need defaulting logic everywhere; one ordered id list in one preference section is a single atomic write per gesture.
- **Reordering via the llm directory registration** — the directory order is adapter-owned declaration order; mutating it for one user's preference would leak presentation into the adapter topology.

## Consequences

The preference is durable (`settings.yaml` gains a `models:` section), live-applied (`applies: 'live'`), and readable by any future surface through the same `llm.providers`/`llm.models`/`session.models` responses. Providers without a stored position — dormant routes that activate later, newly declared ones — land at the natural end until the user drags them into place, which keeps the list self-contained. The keyboard path and the drag path share one `moveRow`/`persistOrder` implementation, so the e2e pins the keyboard gesture while the component suite pins drag events, drop-target highlighting, same-position no-ops, failure surfacing, and the read-only disable. The host sorting is pinned by api-proxy specs covering both preference-present and preference-absent orderings. The keyless browser scenario (`apps/web/tests/models-settings.e2e.ts`) now reorders the declared route above the configured one and asserts both the `settings.yaml` write and the re-rendered row order, with the ARIA goldens updated for the new handle buttons.
