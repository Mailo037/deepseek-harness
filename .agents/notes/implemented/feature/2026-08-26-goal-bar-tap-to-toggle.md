# Agent Note: GoalBar expands and collapses by tapping the strip on touch layouts

Status: implemented

English | [中文](2026-08-26-goal-bar-tap-to-toggle.zh.md)

## Problem

On touch layouts the GoalBar's expand/collapse verb lives one level deep: the strip's icon row is hidden and every read verb, including expand/collapse, is folded into the kebab menu. Reading a long objective is the strip's most frequent non-mutation action, and requiring a menu tap for it makes the disclosure feel buried. The product ask (2026-08-26) is to toggle the read view by tapping the strip itself.

## Decision

The strip body (`css.bar`, collapsed and expanded) carries `onClick={handleBarTap}`. The handler ignores taps whose target resolves to a control (`closest('button')` — the kebab seat and any future button), then toggles `expanded` only when the touch-layout media query matches. The query string `'(max-width: 768px), (hover: none), (pointer: coarse)'` mirrors `GoalBar.module.css`'s touch-layout block so the JS gate and the CSS seat stay the same layout; the call is optional-chained so jsdom and non-browser lanes no-op. The touch block also sets `cursor: pointer` on the bar, which matters on narrow fine-pointer windows where the query applies without a touch pointer.

Fine-pointer desktops are deliberately excluded: the expanded view's objective is selectable text there, and a body click would collapse it mid-selection. Those layouts keep the hover-revealed chevron as the only toggle. The kebab menu keeps its expand/collapse row, so screen readers and keyboard users keep an accessible seat on touch layouts.

## Alternatives considered

**Toggle on every layout.** One handler, no media query. Rejected because the expanded objective is selectable on fine-pointer desktops; a click intended to select text would collapse the panel. The chevron already covers desktop disclosure.

**A CSS-only affordance with the chevron as the sole trigger.** No new behavior; leaves the menu tap as the only touch path. Rejected because that is exactly the burial the ask names.

**Move the expand row out of the kebab menu.** A second always-visible icon seat in the collapsed strip. Rejected as scope creep: it re-introduces the per-verb width pressure the menu collapse exists to avoid, and the tap covers the common case without any new chrome.

## Consequences

- Touch-layout taps on the strip body toggle the read view; taps on the kebab seat, the menu list (which stops propagation), and menu rows keep their own verbs.
- Desktop behavior is unchanged: the chevron remains the only toggle, and the expanded objective stays freely selectable.
- The media query is stated twice (CSS block and JS constant); they must be edited together. A comment on the constant names the coupling.
- Component tests cover the gate: touch taps toggle, kebab taps do not, and a fine-pointer click on the body is a no-op.
