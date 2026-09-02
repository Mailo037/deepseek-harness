# Agent Note: Interactive Harness-home reset

Status: implemented

English | [中文](2026-09-01-interactive-harness-reset.zh.md)

## Problem

Clearing persisted conversations required finding and deleting implementation-owned directories under `$DSH_HOME` by hand. Removing the whole directory also discarded model selection, managed API credentials, profile overlays, and user skills even when the user only wanted a clean chat list. A product command needs to state the scope before deletion, require explicit confirmation, and refuse broad filesystem locations.

## Decision

The product launcher owns an interactive `dsh reset` mode, with `pnpm dsh:reset` as the source-checkout alias. It resolves the same `$DSH_HOME` as every other launcher mode and offers two deletion scopes:

- Chat data removes the `sessions`, `attachments`, and `storages` children. These locations jointly own session logs, attachment bytes, workspace chat lists, archive and pin state, and message feedback. The command preserves `settings.yaml`, `.credentials.yaml`, profiles, skills, provider/model settings, and API credentials.
- Complete reset removes the resolved `$DSH_HOME` directory and all user state beneath it.

The scope selection does not authorize deletion. After showing the resolved path and the consequences of the selected scope, the launcher requires one affirmative `y/N` confirmation. Empty, negative, and cancelled input leaves the filesystem unchanged. Deletion uses fixed child names for the chat scope; complete reset rejects a filesystem root, the operating-system user home, and the current working directory. The command must run while Harness applications are stopped so no process can retain or rewrite files during deletion.

## Alternatives considered

**Delete only `sessions`.** Rejected because attachments would become unreferenced residue and the web workspace, archive, pin, and feedback sidecars would continue to point at deleted sessions.

**Reset settings through a running profile plugin.** Rejected because reset must remain available when a profile cannot boot due to broken configuration, and deletion of launcher-owned home data does not require an application tree.

**Make complete reset the only mode.** Rejected because model setup and managed credentials are independent of chat history and can be costly to reconstruct.

## Consequences

Users can clear all conversations without reconfiguring providers, or deliberately return the installation to first-run state. The launcher exposes the same behavior in installed and source-checkout forms. Custom deployments that place additional chat-related data outside the three standard children remain responsible for that data, while any data placed inside `$DSH_HOME` is included in complete reset.

## Testing

CLI argument tests pin the reset dispatch and reject mixed parent options or extra arguments. Filesystem tests exercise chat-only preservation, complete deletion, negative confirmation, invalid selection, and broad-home rejection. A source-command smoke proves `pnpm dsh:reset` reaches the interactive launcher and cancellation performs no deletion.
