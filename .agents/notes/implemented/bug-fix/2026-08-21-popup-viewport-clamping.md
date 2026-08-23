# Agent Note: Popups stay inside the viewport on mobile

Status: implemented

English | [中文](2026-08-21-popup-viewport-clamping.zh.md)

## Problem

The composer's model-selector menu was positioned with pure CSS (`position: absolute; right: 0; bottom: calc(100% + 8px)`), so its placement depended entirely on where the trigger happened to sit. On a phone viewport — where the composer and its controls are close to the screen edges — the 320px menu could run off the left or right edge, and a long menu near the top of the screen could run off the top. Other popups already clamped themselves to the viewport in JavaScript (`Menu` portal mode, `Select`/`MultiSelect` via that portal, `Tooltip`, `HoverCard`), so the model selector was the remaining offender, but the primitive `Menu`'s default non-portal lists had no width bound to the viewport either.

## Decision

- **`ui-model-selection` ModelSelect menu:** the open menu is now placed from the trigger's bounding rect before paint, on every window resize, and on every open-menu size change (a `ResizeObserver` on the menu card) — drilling into a pane, a catalog load, or a group expansion all grow the card after the initial placement, and a top-anchored card would otherwise extend past the viewport's bottom edge. `placeMenu()` keeps the preferred right-aligned-above placement, then clamps both axes to the viewport with an 8px margin, flipping below the trigger when the space above is exhausted. The result is root-relative `left`/`top` inline styles (with explicit `right`/`bottom: auto` so the CSS default cannot stretch the auto-height card), so the menu stays absolutely anchored to the trigger and scrolls with it. `null` keeps the CSS default for the one pre-paint frame.
- **`ui-primitives` Menu cards:** the shared `.list`/`.submenu` surface now carries `max-width: min(360px, calc(100vw - 24px))`, so no menu card can ever be wider than the viewport (24px = twice the portal margin).

## Alternatives considered

- **A portal + fixed positioning for the model menu, exactly like the `Menu` primitive's portal mode:** rejected — the seat's menu is a custom two-level surface (root/model/effort panes, search, grouped list), and the composer deliberately avoids ancestor transforms (see `ConversationRoot.module.css`), so absolute positioning against `.root` with clamped coordinates is simpler and scrolls with the trigger for free.
- **CSS-only guards (viewport-bounded `max-width`, `overflow`):** rejected for horizontal placement — pure CSS cannot know the trigger's position, so only the width cap is CSS; the position clamp must be JavaScript.

## Consequences

No popup in the app can run off the viewport on mobile: the model menu clamps and flips instead of overflowing, and re-placing on menu growth keeps a drilled-in or freshly loaded card inside the fold; the `Menu`/`Select` cards are width-bounded everywhere. The model menu keeps its existing geometry when there is room (right-aligned, opening upward), so desktop placement is unchanged. The clamp re-runs on resize and menu size change only; while a menu is open the absolute positioning follows the anchor on scroll, which is the anchored-menu behavior the portal mode re-creates with more machinery.

## Testing

`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` covers `placeMenu` as a pure function: the preferred placement when it fits, left/right edge clamping, the below-flip when there is no room above, the top-margin fallback when neither side fits, and the root-offset conversion. A component spec stubs `ResizeObserver`, opens the menu near the viewport bottom, grows the card after placement, fires the observer, and asserts the inline `top` was recomputed upward instead of extending past the fold. All 28 model-selection tests and the 544 ui-primitives/rows tests pass.
