# Agent Note: Chat transcript opens a short recent window and pages older history on scroll

Status: implemented

English | [中文](2026-08-21-incremental-history-window.zh.md)

## Problem

Opening a long session loaded the whole tail page at once: the browser requested `PAGE_MESSAGES` (50) messages on open, so a long conversation pulled a large window before the reader saw anything, and older history only arrived behind an explicit "Load earlier" button. There was no way to open a conversation on a short recent context and page the rest in as the reader scrolled up.

## Decision

The chat transcript opens on a short recent window and pages older history on scroll-up.

The runtime tail-page size on open is now `INITIAL_PAGE_MESSAGES` (4 messages, roughly the last two request/response pairs; the host cuts at message-group boundaries) in `Session.doOpen`, while the older-history pages stay at `PAGE_MESSAGES` (50). `loadOlder` and gap repair keep their existing page size — only the initial `session.history` pull is shortened, so a long conversation mounts a small recent window immediately instead of a 50-message tail.

ChatView adds two ways to reach older history alongside the existing button (which stays, so a short non-scrollable window always has an affordance):

- **Scroll-up paging**: a reader scroll that reaches the loaded head (`el.scrollTop <= OLDER_TRIGGER_TOP`, 8px) with `hasMore && !loadingOlder && openState === 'open'` pulls the next page through the existing anchored `loadOlder` path, preserving the reading position across the prepend. The `movedByReader` guard keeps programmatic prepend adjustments from re-triggering.
- **Auto-fill**: when the loaded window does not fill the scrollport (`clientHeight > 0` and `scrollHeight - clientHeight <= 0`), the effect keeps pulling pages until the flow is scrollable or history ends, so the initial 4-message window can always be scrolled. Pinned readers stay pinned (prepends grow above via the follow logic); the `clientHeight` guard keeps jsdom unit tests on the scroll-driven path.

## Alternatives considered

**Keep 50 messages on open and rely on the existing button only.** Rejected: the user asked for a short recent window plus scroll-up paging, and a short window is often shorter than the viewport, so scroll-up paging alone would leave older history unreachable until the window overflows.

**Load exactly two user requests via a larger page and stop after them.** Rejected: `maxMessages` counts user *and* assistant messages, and the host cuts at message-group boundaries, so "two request/response pairs" is naturally `INITIAL_PAGE_MESSAGES = 4`; a larger initial page would reintroduce the big-window-on-open behavior this change removes.

**Trigger scroll-up paging within a wider band (160px).** Rejected: it collided with unit tests that scroll a reader to a positioned anchor (offsets 50/80) as part of anchor-preservation setup; narrowing to the top zone (8px) keeps those read positions from being misread as page requests while still firing for `wheelToHistoryStart` and `scrollTop = 0` in the e2e lanes.

## Consequences

A long conversation loads fast onto a short recent context, and scrolling up (or the existing button) loads the rest page by page. The runtime and UI always keep a paging affordance, so no history is hidden even when the initial window does not fill the viewport. Because the initial `session.history` pull is smaller, the stats/aria/perf e2e expectations around "which turns are mounted on first open" shift; the tests that asserted an exact 24-turn initial window now assert a bounded partial window, and the tests that drove paging via the button now drive it by scrolling to the loaded head.
