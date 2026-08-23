# Agent Note: Pinned session sidebar categories

Status: implemented

English | [中文](2026-08-22-pinned-session-sidebar-categories.zh.md)

## Problem

Session actions existed in both the sidebar row menu and the conversation header menu, but neither surface could keep important Sessions above Workspace grouping. Ungrouped Sessions also appeared as a synthetic Workspace folder, which made the sidebar hierarchy imply ownership that does not exist.

## Decision

The Workspace registry owns an ordered, durable, registry-global set of pinned Session ids alongside the archive set. A Session can be pinned from either Session menu. The sidebar row menu opens from both its ellipsis button and a right-click anywhere on a non-blank Session row; the context-menu form is anchored at the pointer and suppresses row navigation. The sidebar removes pinned Sessions from their normal projection and renders them once in a Pinned category above the peer Workspaces and Ungrouped categories. Pinning does not change Workspace accounting. Archiving removes the Session from the pin set atomically, and stored state rejects duplicate ids or overlap between archive and pin sets.

The API and client runtime exchange complete pin snapshots through the Workspace list baseline, the pin mutation response, and a Host changed frame. This matches the archive projection's reconnect and multi-client behavior.

The category transition reuses the sidebar's short fade-and-rise motion and respects reduced-motion preferences. The existing search expansion motion remains unchanged.

## Alternatives considered

Storing pins only in browser local storage would not survive another client or provide one authoritative order. Moving a pinned Session into a special Workspace would alter its real accounting and break the requested category relationship. Rendering pinned Sessions in both locations would produce duplicate navigation rows.

## Consequences

Pinned Sessions retain their Workspace and return to the same normal category when unpinned. Ungrouped no longer exposes Workspace-only add or options controls. Older registry state defaults the new pin set to empty without changing the stored domain version.

## Testing

Registry tests cover durability, order, idempotency, unknown and archived Sessions, and archive removal. API tests cover unary responses, errors, reconnect snapshots, and Host frames. Runtime tests cover baseline and frame precedence. Component tests cover both pin surfaces, pointer-positioned right-click opening without navigation, category order, duplicate suppression, and unpinning from the pinned row.
