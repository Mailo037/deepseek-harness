# Agent Note: Restored web navigation state

Status: implemented

English | [中文](2026-08-24-restored-web-navigation-state.zh.md)

## Problem

The browser kept the current Session selection across a reload, but discarded the open Settings panel and its selected section. A reload therefore returned to the conversation even when the user had been working in a specific Settings section.

## Decision

`SessionRuntime` continues to persist its selected Session in `dsh.sessions.current` and validates that selection against the fresh Host list. An unavailable Session clears the current selection, which projects the New Session view instead of retaining an unusable destination.

`ui-settings-general` owns a root-scoped `SettingsNavigationStore` persisted as `dsh.settings.navigation`. Its `open` and `select` actions retain the visible panel and latest section id independently from Session data and the settings document. `close` clears both values, so only the currently open Settings view returns after a browser refresh.

The Settings panel renders its first available section while a persisted section is not registered. It retains the stored id, allowing dynamically loaded section registrations to restore the requested view without changing persisted browser state.

## Alternatives considered

**URL fragments and browser-history routes.** Rejected because the Settings panel is a modal view rather than a routable page, and address-bar navigation needs share, back/forward, and link-compatibility semantics beyond restoring one browser's current view.

**One navigation record shared with SessionRuntime.** Rejected because Settings are root-scoped and remain meaningful with no selected Session; coupling them would make a missing Session erase unrelated viewing state.

**Component-local React state.** Rejected because component state cannot rehydrate after a full browser reload or survive the root entry's lifecycle.

## Consequences

Refreshing an existing Session restores that Session; refreshing after its persisted Session disappears opens New Session. Refreshing while Settings is open restores the panel and its selected section. `sessions-service.client.spec.ts` pins missing-session fallback, and `settings-root.client.spec.tsx` mounts a fresh persisted Settings store to pin panel and section rehydration.
