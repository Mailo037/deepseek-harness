# Agent Note: Composer file attachments and the plus-button attachment menu

Status: implemented

English | [中文](2026-08-22-composer-file-attachments.zh.md)

## Problem

The composer's plus button opened the slash-command list — the only launch point for a menu the `/` trigger already owns — while attachments were images-only: pasted or picked non-image files were rejected with a format toast, and pasting a very large text block ballooned the draft instead of becoming an attachment. There was no way to hand the session a file that is not a raster image.

## Decision

- **Plus button → attachment context menu.** The plus launcher now opens its own `Menu` (upload entry today; more entries later) backed by a hidden multi-file picker whose intake rides one injected `addFiles` path. The slash-command list keeps its only trigger: typing `/` in the textarea; the bar no longer calls `toggleCommandMenu`, and the inject face dropped it.
- **Attachments are a union, not images.** `ComposerAttachment` is `'image' | 'text' | 'workspace-file'`; the input machine's id list was already kind-agnostic, so the rename (`imageIds`→`attachmentIds`, `addImages`→`addAttachments`, …) is mechanical and every existing flow (empty-draft send, queue-edit stash, workspace-switch transfer, command claim gates) carries files for free. Submit serializes per kind: images as image blocks, `text` as a fenced `[Attached file: …]` prompt block (fence longer than any backtick run in the content), `workspace-file` as a one-line path reference. All blocks are part of the durable user message, so model-visible ⟺ logged holds without a new session event.
- **Binary and oversized files upload into the workspace.** New `session.uploadAttachment` RPC writes the bytes to `<session cwd>/.uploads/<timestamp>-<name>` (basename-sanitized, fixed 25 MiB bound, traversal-guarded) and returns the workspace-relative path; the prompt block names that path so the agent reads the bytes itself with its file tools. Text files up to 1 MiB ride inline instead (NUL-byte probe over the first 8 KiB decides textual vs binary).
- **Large pastes become restorable attachments.** A paste of ≥50,000 characters registers a `text` attachment named `pasted-text.txt` (`-2`, `-3`, … on collision) with `restorable: true`; the rail chip's undo control splices the content back into the draft at the caret as one machine transaction and drops the chip.
- **Rail chips.** Non-image rail items render as document chips (paperclip, name, size, hover-revealed remove/restore controls); only image items keep thumbnails and the lightbox.

## Alternatives considered

- **A durable non-image attachment store mirroring images** (sha256 store + transcript gallery + provider transport) — rejected for now: nothing consumes arbitrary binary content at the model boundary, while the agent already owns file tools against the workspace, so a path reference delivers the same capability without a second storage plane.
- **Inline base64 for binary files** — rejected: it bloats the prompt and the model cannot decode PDFs or archives from base64 any better than it can read a path.
- **Upload-at-submit for workspace files** — rejected: submit-time uploads would make Enter slow and fail-prone exactly when the user expects dispatch; intake-time upload keeps the chip honest (the path exists before the draft can be sent).

## Consequences

File attachments survive session switches but not page reloads — the same browser-owned lifetime draft images always had. Commands that accept attachments stay image-only: a claimed command meeting a file attachment rejects through the localized "commands accept image attachments only" notice at serialize time. `.uploads/` appears inside the session's project directory and is intentionally unmanaged (no gitignore injection, no pruning); the host bound caps abuse. The lifecycle-chrome e2e golden for the launched slash menu is gone with the plus-button launch path; the typed-`/` fuzzy golden remains.
