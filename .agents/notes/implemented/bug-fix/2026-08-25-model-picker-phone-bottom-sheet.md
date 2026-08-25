# Agent Note: Model picker phone bottom sheet

Status: implemented

English | [中文](2026-08-25-model-picker-phone-bottom-sheet.zh.md)

## Problem

On phone viewports the composer's model picker rendered as an absolute card that spanned the viewport width but kept an 8px margin on every side, always opened upward from the trigger, and capped its height at `100vh - 96px`. The result was clipped: the search field sat under the browser chrome, and a catalog with several provider groups ran the last rows past the fold with no way to reach them. Because the card covered the viewport's lower half, tapping outside it was also unreliable, so the only dismissal gestures were an outside tap that could miss and a keyboard Escape that a phone does not offer.

## Decision

Below the existing 639px phone breakpoint the open menu is a `position: fixed` **bottom sheet** anchored to the viewport's bottom edge and self-sized by the `--sheet-h` custom property. It rests at half the viewport height (`50dvh`), can be dragged up to near-fullscreen (`92dvh`), and dismisses when it is pulled past a quarter-height threshold. A drag handle — the `.sheetHandle` grab zone across the sheet's top edge — drives the height: while dragging, pointer handlers write `--sheet-h` straight to the DOM so the sheet tracks the finger without a re-render per move, and on release it snaps back through a `height` transition to rest or expanded (or closes when past the dismiss threshold). `setPointerCapture` is guarded because jsdom ships a throwing stub. The phone arm of the placement layout effect owns no geometry: it publishes a `{ sheet: true }` sentinel that reveals the sheet on the first frame, creates no `ResizeObserver`, and listens for no resize. A header row (the `menu.aria` title plus a 32px close button on the trailing edge) renders only while `phone`; it closes through the same `close(true)` path as the desktop dropdown and restores focus to the trigger. The model list gains `flex: 1 1 auto` on phone so it scrolls in the space under the handle, header, and search field instead of growing the sheet. `--sheet-h` snap targets use `100dvh` so the on-screen keyboard shrinking the dynamic viewport keeps the expanded sheet inside the screen.

## Alternatives considered

**Keep the earlier fullscreen overlay and only add a close button.** Rejected in favor of a sheet: the picker does not need to take over the whole screen, and a half-viewport sheet leaves the composer visible above it and offers a drag-to-dismiss gesture a phone touch affordance expects.

**Keep the margin-spanned card and only raise its height cap.** Rejected: the card's top still anchored to the trigger rect, so the search field stayed under the browser chrome on tall catalogs, and the fold problem returned whenever the catalog outgrew the cap.

**Portal the menu to `document.body` for phone.** Rejected: the composer stack already avoids a transform ancestor precisely so `position: fixed` descendants cover the viewport (ConversationRoot's `.composerHero`), so the CSS-only fixed sheet needs no portal, no focus-trap wiring, and no new module-graph edge.

## Consequences

The picker becomes a phone bottom sheet that rests at mid-viewport and expands on an upward drag — matching the mobile drawer/sheet convention — instead of the fullscreen takeover the earlier iteration had. Tapping outside still closes it (the outside-mousedown handler covers the composer area above the sheet), and the header close button plus Escape remain as pointer- and keyboard-accessible dismissals. The desktop dropdown keeps its measured, viewport-clamped placement unchanged; `model-select.client.spec.tsx` pins the phone arm (no inline placement, no `ResizeObserver`, resize- and pane-stable geometry) and the drag paths for rest, expanded, and dismiss.
