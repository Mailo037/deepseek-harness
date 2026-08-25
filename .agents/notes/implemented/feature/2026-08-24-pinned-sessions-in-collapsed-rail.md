# Agent Note: Pinned sessions remain available in the collapsed sidebar

Status: implemented

English | [中文](2026-08-24-pinned-sessions-in-collapsed-rail.zh.md)

## Problem

The collapsed sidebar retained its workspace add and session search controls but hid the pinned Session navigation that the expanded browser presents first. Reopening the sidebar only to enter a pinned Session made the compact rail lose the operator's deliberate shortcut set.

## Decision

`WorkspaceBrowser` derives the collapsed rail from the same `derivePinned` projection as the expanded Pinned category. It renders each visible pin in durable pin order as a 36px generic chat-icon button, separated from the add and search controls by 12px. Its right-click gesture opens the same pointer-positioned Session action menu as an expanded row. The standard Session hover card is shared by every non-blank row and rail pin: clicking its title turns it into an input with the static title's typography. Enter trims the value and calls the existing `renameSession` mutation, with a pending state and inline rejection error. The current Session receives `aria-current="page"` plus the selected visual state. Selecting a pin calls the ordinary `open` action directly, so the Session changes without expanding the sidebar. Missing, blank, subagent, and archived Sessions remain excluded by `derivePinned`; no new durable state or pin policy is introduced.

## Alternatives considered

**Expand the sidebar before opening a pinned Session.** This retains one navigation presentation, but adds the transition the rail exists to avoid and makes a pin less direct than New Session or search.

**Render recent Sessions in the rail.** Recency is not an operator's explicit shortcut set and would create a second, independent ordering rule. Durable pins already express the intended compact navigation list.

## Consequences

Pinned Sessions are reachable from either sidebar width and their order remains stable across both presentations. A long pin list scrolls inside the available rail height, while non-pinned Session navigation remains in the expanded browser. `workspace-browser.client.spec.tsx` verifies filtering, order, active state, inline rename, and the rail context menu; `rows.client.spec.tsx` verifies the same inline title behavior for a non-pinned row; `browser-styles.client.spec.ts` verifies the rail geometry and scrolling rule; `pinned-session-rail.e2e.ts` pins the menu-to-rail path, title typography, inline rename, and the rail context menu in the built Web client.
