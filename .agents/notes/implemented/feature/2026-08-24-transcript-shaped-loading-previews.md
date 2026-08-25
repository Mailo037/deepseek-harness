# Agent Note: Transcript-shaped loading previews

Status: implemented

English | [中文](2026-08-24-transcript-shaped-loading-previews.zh.md)

## Problem

Opening a Session showed three generic bars before its transcript replayed. The sidebar baseline showed circular markers, title bars, and metadata bars that resembled profile rows rather than the Workspace and Session browser the page was about to render. Neither loading state showed the information hierarchy that would replace it.

## Decision

ChatView renders a fixed assistant/user/assistant preview during `openState === 'loading'`. It reuses the existing assistant body and user-bubble geometry, but exposes only local loading lines. The localized history-loading status remains the sole accessible content; the preview creates no Conversation Node, message text, or Host request.

WorkspaceBrowser renders two folder rows and three indented chat rows while either list baseline is pending. Folder and chat glyphs retain the browser's Workspace/Session distinction, while only title space pulses. The sidebar preview is hidden from assistive technology and has no actions or data identity.

Both previews disable their pulse animation under reduced motion.

## Alternatives considered

**Keep generic bars.** They conceal who said what in the transcript and make the sidebar look like an unrelated profile list.

**Show plausible loading copy.** Invented messages, Workspace names, or timestamps would be indistinguishable from real history during a slow replay.

**Delay all chrome until data arrives.** An empty column removes orientation during the same wait without improving loading correctness.

## Consequences

The loading state carries the same visual hierarchy as the content it precedes without adding another projection or loading request. ChatView and WorkspaceBrowser tests pin the assistant/user and Workspace/Session row composition; the existing status and baseline behavior remain unchanged.
