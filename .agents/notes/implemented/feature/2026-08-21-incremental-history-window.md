# Agent Note: Chat transcript opens a short recent window and pages older history on scroll

Status: implemented

English | [中文](2026-08-21-incremental-history-window.zh.md)

## Problem

Opening a long session loaded the whole tail page at once: the browser requested `PAGE_MESSAGES` (50) messages on open, so a long conversation pulled a large window before the reader saw anything, and older history only arrived behind an explicit "Load earlier" button. There was no way to open a conversation on a short recent context and page the rest in as the reader scrolled up.

## Decision

The chat transcript opens on a short recent window and pages older history on scroll-up.

The runtime tail-page size on open is `INITIAL_PAGE_MESSAGES` (4 messages, roughly the last two request/response pairs; the host cuts at message-group boundaries) in `Session.doOpen`. Older-history pages grow exponentially: the first page requests `PAGE_MESSAGES` (50) and each subsequent page doubles it (`loadOlderPageSize`: 50, 100, 200, 400, then a `MAX_PAGE_MESSAGES` cap of 800), so deep scroll-up reuse fetches progressively more history with the same request count. `loadOlder`'s page counter grows only while history remains (`hasMore`); it resets on exhaustion so a later re-request starts at the base size. Gap repair keeps its existing base page size — only older-history paging grows.

ChatView adds two ways to reach older history alongside the existing button (which stays, so a short non-scrollable window always has an affordance):

- **Scroll-up paging**: a reader scroll that reaches the loaded head (`el.scrollTop <= OLDER_TRIGGER_TOP`, 200px) with `hasMore && !loadingOlder && openState === 'open'` pulls the next page through the existing anchored `loadOlder` path, preserving the reading position across the prepend. The generous band pages while the reader is still a short way from the head — combined with exponential page sizes, the next page is already in flight as the reader closes on it. The `movedByReader` guard keeps programmatic prepend adjustments from re-triggering.
- **Auto-fill**: when the loaded window does not fill the scrollport (`clientHeight > 0` and `scrollHeight - clientHeight <= 0`), the effect keeps pulling pages until the flow is scrollable or history ends, so the initial 4-message window can always be scrolled. Pinned readers stay pinned (prepends grow above via the follow logic); the `clientHeight` guard keeps jsdom unit tests on the scroll-driven path.

## Alternatives considered

**Keep 50 messages on open and rely on the existing button only.** Rejected: the user asked for a short recent window plus scroll-up paging, and a short window is often shorter than the viewport, so scroll-up paging alone would leave older history unreachable until the window overflows.

**Load exactly two user requests via a larger page and stop after them.** Rejected: `maxMessages` counts user *and* assistant messages, and the host cuts at message-group boundaries, so "two request/response pairs" is naturally `INITIAL_PAGE_MESSAGES = 4`; a larger initial page would reintroduce the big-window-on-open behavior this change removes.

**Trigger scroll-up paging only at the exact top (8px).** This was the original shipped value, chosen to keep anchor-preservation test reads (offsets 50/80) from being misread as page requests. It was later replaced by the wider 200px band once exponential page sizes made early paging beneficial; a reader scrolling to a positioned mid-window anchor still does not page because that read lands below 200px, and the mid-window "does not page" unit test now uses a 300px position. The narrow 8px value made paging wait until the very head, so the next page never started until the reader had already stalled at the top.

**Keep the older page size fixed at 50.** Rejected once the trigger band widened: a fixed short page would force many round-trips to load deep history and would leave the generous band paging a thin slice each time. Exponential growth reuses the same request count for progressively more history, bounded by `MAX_PAGE_MESSAGES` so no single request unboundedly grows.

## Consequences

A long conversation loads fast onto a short recent context, and scrolling up (or the existing button) loads the rest page by page, with each page larger than the last. The runtime and UI always keep a paging affordance, so no history is hidden even when the initial window does not fill the viewport. Because the initial `session.history` pull is smaller, the stats/aria/perf e2e expectations around "which turns are mounted on first open" shift; the tests that asserted an exact 24-turn initial window now assert a bounded partial window, and the tests that drove paging via the button now drive it by scrolling to the loaded head. The exponential page size means fewer requests to exhaust a long log, which also shortens the trajectory view's eager history drain.
