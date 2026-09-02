# Agent Note: Mobile surfaces open a shared bottom sheet

Status: implemented

English | [中文](2026-08-29-mobile-tool-call-bottom-sheet.zh.md)

## Problem

Three conversation surfaces are cramped or abrupt on a phone viewport. An expandable tool-call row expanded its body inline, growing the message flow and forcing a long IN/OUT card, terminal, diff, read, search, or web body into one narrow column. The session-header background-job list and the subagent catalog both opened as popovers anchored to the header, which either overflow the narrow viewport or depend on hover (the subagent catalog opened on hover, so a touch tap could not open it). And the popovers appeared and vanished instantly — there was no dismiss animation. The sheet also had to stay live: a tool call still streaming must show the latest body when the user taps it, never a snapshot captured at tap time.

## Decision

`@deepseek-ai/dsh-client-ui-primitives` ships a controlled `BottomSheet` primitive (`BottomSheet.tsx` + `BottomSheet.module.css`). It is the reusable phone surface: a full-width, bottom-anchored card that portals to `document.body` (so an owner inside a scroll container or transformed ancestor cannot trap it), rests at half the viewport, slides up on open, and can be dragged between the rest and a near-fullscreen expanded height, or pulled down past a dismiss threshold to close. It owns the mask (tap to close), a title header with a close button, the drag handle, the `--sheet-h` height property, `Escape` close, page-scroll lock while visible, and initial focus into the dialog. The caller passes `open`, `onClose`, `title`, `closeLabel`, and (live) children.

Closing is animated: when `open` goes false the sheet stays mounted through a slide-down (and a mask fade) before unmounting, so dismissal is a gesture rather than an instant removal. Callers therefore keep the component mounted while they might show it — they render `<BottomSheet open={...}>` unconditionally (not gated on `open`) and drive visibility purely through the prop.

Six surfaces use it, each gated by the same `matchMedia('(max-width: 639px)')` breakpoint the composer and model selector use:

- `ToolRow` (`ui-tool`) never expands inline on phone — its `open` flag stays false and the row remains one line — while the row click opens the sheet holding the same expanded body. The body is a single element reused by both surfaces, so it re-renders with the row's live props: a streaming call stays current inside the open sheet. The `BashRow` bash toolview carries the identical behavior, since the bash key is the shipped renderer for bash calls.
- `JobListAction` (`ui-jobs`) renders its job rows inside the sheet instead of the header-anchored popover. Its outside-pointer dismiss listener is disabled on phone (the sheet's mask owns dismissal), and the rows' kill/log interactions are unchanged.
- `SubagentHeaderLineage.CatalogDropdown` (`ui-subagent`) renders its catalog tree inside the sheet. On phone there is no hover, so the trigger is also the tap target (click opens the sheet); the hover-open/close timers and the outside-pointer/placement listeners are disabled on phone.
- `LineChangeSummary` (`ui-deliverables`) renders its "N files changed" per-file breakdown inside the sheet instead of the composer-anchored popover, with its outside-pointer listener disabled on phone.
- `ReasoningRow` (`ui-conversation`) never expands the thinking text inline on phone — the row stays one line and opens its reasoning text in the sheet, which stays live while the text streams.
- `ToolCallGroup` (`ui-conversation`) opens its contiguous tool/think window as a sheet on phone instead of expanding the run inline. Each row inside the sheet keeps its own phone sheet, so tapping a row opens that call's body sheet on top of the window.

The `conversation`, `subagent`, and `deliverables` locale namespaces each gain a `sheet.close` key (`关闭` / `Close`) for the sheet's close-button label.

The `ModelSelect` model picker (`ui-model-selection`) — which originally hand-rolled this same phone sheet (its own `--sheet-h` drag, handle, header) — now uses the shared primitive as well, so its two-level panes render in the sheet with the same chrome, drag/snap, and animated close. Its bespoke drag constants/handlers were deleted.

## Alternatives considered

**Keep the inline expansion and header popovers on phone.** The tool body already scrolls inside its own card, but a long payload still consumes the narrow conversation column and pushes the surrounding messages away; the header popovers overflow the narrow viewport, and the subagent catalog's hover-open is unreachable on a touch screen.

**Copy the model selector's sheet code into each consumer.** Every consumer would then maintain duplicate drag/handle/mask logic. A shared primitive in `ui-primitives` keeps the mobile surface in one place, and the model selector can adopt it later.

**Capture the body at open time into state.** A tool call can still be streaming when the user opens the sheet, so a frozen snapshot would go stale. Rendering the same live element from the row's props keeps the sheet current without a subscription or a second data source.

**Unmount immediately on close.** Dismissing is then an instant removal with no affordance. Keeping the surface mounted for the transition is the standard controlled-dialog pattern and needs only that the caller not gate the mount on `open`.

**Route the tool row through the existing Details panel.** That is a separate full-height pane keyed by a global selection, not the row's own body, and does not answer "show me this row's content."

## Consequences

On a phone, an expandable tool-call row stays one line and its body opens in a draggable, full-width, aria-modal sheet; the same sheet carries the reasoning ("Think") text, a run's tool-call window, the background-job list, the subagent catalog tree, and the composer's per-file change breakdown. The page behind the sheet is scroll-locked, and dismissal slides the sheet down and fades the mask before unmount. Desktop behavior is unchanged: tool rows, thinking, and the run window expand inline, and the jobs/subagent/deliverables menus remain popovers. The shared `BottomSheet` primitive is available to any future phone surface, and the tool/reasoning body has one source regardless of surface. The sheet does not auto-scroll to the newest output while a streaming call grows it — the reader scrolls or expands the sheet, which is deferred work.

## Testing

The `BottomSheet` component spec pins open/close through the close button, the mask tap, and `Escape`; the through-transition mount-then-unmount on close; page-scroll lock and restore; live child re-render; the rest-height snap; and drag-to-dismiss past the threshold. The `ToolRow`, `BashRow`, `JobListAction`, `SubagentHeaderLineage.CatalogDropdown`, `LineChangeSummary`, `ReasoningRow`, and `ToolCallGroup` specs pin that on a phone viewport the surface opens in a bottom-sheet dialog (with the popover/tree/file/reasoning/row content inside) rather than inline or as a popover, and that the dialog's close button starts the slide-down then unmounts it. The web snapshot replay (`DSH_SNAPSHOT=replay pnpm run test:web`) exercises the assembled browser output for the changed conversation UI.
