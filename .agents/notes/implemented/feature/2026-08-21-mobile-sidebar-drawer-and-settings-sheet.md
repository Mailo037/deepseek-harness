# Agent Note: Mobile sidebar drawer and settings sheet at phone viewports

Status: implemented

English | [中文](2026-08-21-mobile-sidebar-drawer-and-settings-sheet.zh.md)

## Problem

Below the auto-collapse breakpoint (1024px) the sidebar collapses to a 56px rail, and a manual re-expand renders the expanded column inline at its clamped drag width, squeezing the conversation column to whatever the center track has left. On a phone-sized viewport that leaves the conversation unusable: a 390px screen with a 280px sidebar keeps about 110px of conversation. The settings modal kept its fixed two-column layout — a 188px nav rail beside the content column — at every viewport width, so on a phone the content column shrank to roughly 160px and its preference rows were crushed.

## Decision

The layout frame renders a re-expanded sidebar as an overlay drawer below a new `SIDEBAR_DRAWER_BREAKPOINT` (640px) instead of squeezing the center. The grid keeps the 56px rail track, so the center column holds its full width; the sidebar column becomes an absolutely positioned layer at the drawer width (`drawerWidth()`: capped at 320px, always leaving a 48px viewport margin), with the mask tokens behind it. A mask click closes the drawer through the existing narrow toggle semantics, and the drawer column keeps its overlay mode for the 150ms wide-content fade-out so the closing crossfade is not clipped by the rail track. Between the drawer breakpoint and the auto-collapse breakpoint the re-expand still squeezes the center, preserving the pre-existing behavior and its tests.

The settings panel stacks below 640px: it becomes a full-screen sheet (`100vw` × `100dvh`, no radius) and the nav rail becomes a full-width row above the content, with the section cells scrolling horizontally while the title stays fixed.

## Alternatives considered

**Overlay drawer at every width below the auto-collapse breakpoint.** Rejected: the squeeze re-expand between 640px and 1024px is an existing, tested contract (chat-scroll, composer geometry), and tablet/narrow-desktop windows tolerate a 280px sidebar; the drawer exists for the phone case that cannot.

**Cap the expanded sidebar width so the center keeps a minimum.** Rejected: on a 390px viewport any inline expanded sidebar still leaves the conversation a sliver; only an overlay keeps the center at full width.

**Full-width drawer.** Rejected: the user complaint is that the sidebar covers the whole screen; a partial overlay with a visible masked remainder and the standard click-to-close mask is the corrective.

## Consequences

Phone viewports keep a full-width conversation while the sidebar is open, and the settings dialog gives its rows the whole sheet. The drawer uses the existing rail geometry and collapse crossfade, so the sidebar shell and its slots are unchanged; the layout frame owns the presentation switch. The 640px–1024px squeeze contract is untouched, which keeps the existing narrow e2e scenarios valid. The drawer mask is a pointer-only affordance (like the settings mask); keyboard users close through the rail toggle.

## Testing

AppFrame specs cover the drawer: overlay without center squeeze at 390px, width clamp below the margin floor, backdrop-click close through the fade, the 150ms overlay persistence on collapse, and the 640px–1023px squeeze fallback. The columns spec covers `drawerWidth`. Two web e2e scenarios pin the assembled behavior: a phone-viewport drawer round trip (center width unchanged, mask closes it) and a phone-viewport settings sheet (panel fills the viewport, nav stacked above the content). The full `pnpm run test:gui` suite passes.
