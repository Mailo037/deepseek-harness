# Agent Note: Sidebar archive notification stack

Status: implemented

English | [中文](2026-08-24-sidebar-archive-notification-stack.zh.md)

## Problem

The sidebar displayed only one inline archive outcome. Archiving another Session replaced its Undo or Retry, so a user working through several conversations could lose the action tied to an earlier result.

## Decision

`WorkspaceBrowser` owns a sidebar-local Motion deck for archive outcomes. It retains the three most recent cards, centered and narrower than the sidebar width, keeps the newest card accessible in the compact state, and fans the earlier cards open only when the stacked deck is clicked or activated with Enter or Space on the stack itself. Hover and keyboard focus do not expand it. A second click on a non-button area, an outside pointerdown, or Escape collapses the deck, and the deck also collapses when fewer than two cards remain. Collapsed stacks draw a token-mixed highlight along each card's top edge. Cards stay short so the compact deck remains low in the sidebar. A successful archive offers Undo; archive and restore failures offer Retry; every idle card can be dismissed. The card action disables while its request is pending, and every result is added or changed only after the corresponding archive or restore promise settles. `AnimatePresence` and spring transitions animate entry, exit, and deck expansion; `useReducedMotion` removes motion while preserving the card order and actions. Success cards announce through `status`; failed operations announce through `alert`.

## Alternatives considered

**Keep one mutable inline notice.** Rejected: an outcome for a later archive overwrites the earlier Undo or Retry, precisely when a stack is most useful.

**Add a global notification service.** Rejected: archive is the only current caller, and moving transient state into another plugin would create an unused cross-feature API before a second consumer needs it.

## Consequences

The fourth outcome evicts the oldest card; its Session remains recoverable from the Archived view. `workspace-browser.client.spec.tsx` verifies that two archive outcomes coexist and Undo dispatches the newest card's Session id. `archive-notification-stack.client.spec.tsx` verifies click-only expansion, outside and Escape collapse, and the failure Retry paths. `README.md` documents the placement, expansion gesture, actions, capacity, and reduced-motion behavior.
