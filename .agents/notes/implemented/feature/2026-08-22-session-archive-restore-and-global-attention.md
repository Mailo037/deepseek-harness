# Agent Note: Session archive restore and global attention

Status: implemented

English | [中文](2026-08-22-session-archive-restore-and-global-attention.zh.md)

## Problem

Archived sessions needed a route back to their retained workspace accounts, and session state requiring an operator was distributed across the normal sidebar hierarchy.

## Decision

`WorkspaceRegistry.unarchiveSession()` removes an id from the durable archive set without changing its workspace account. The Host exposes the inverse `workspace.unarchiveSession` RPC and full archive-set response; the runtime installs that response before the corresponding registry frame arrives.

The sidebar offers archived and Needs attention views. Needs attention filters authoritative session summaries for pending approvals, questions, plan reviews, retry-exhausted failures, completed background work, running sessions, and running subagents. Folded workspace rows show a warning indicator when any hidden member matches the same projection predicate. Archive success exposes Undo, and archive or restore failures stay visible with a retry action.

## Alternatives considered

### Delete archived session records

Rejected because archive is a visibility choice, not destruction; preserving the existing account returns a restored session to its previous group and order.

### Derive attention from rendered sidebar rows

Rejected because collapsed groups and unselected sessions may have no rendered row. The view derives directly from the session and projection registries.

## Consequences

- Archive and restore are idempotent durable registry operations.
- The attention view intentionally includes completed and running background activity as well as blocking and failure states.
- A session unavailable from the current list cannot be rendered in the archive view until its summary baseline arrives.
