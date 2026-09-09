# Agent Note: Web @-menu domain icons and the create_session chat-start tool

Status: implemented

English | [中文](2026-09-02-reference-menu-icons-and-session-start-tool.zh.md)

## Problem

The Web composer's `@` menu labeled every reference row with a text prefix (`File ·`, `Folder ·`, `Session ·`) while the `/` menu led each row with a domain glyph — the two menus sat side by side with different visual languages, and the prefixes duplicated what the section headings (`Files & folders`, `Session conversations`) already said. Separately, an agent asked to hand off work to a fresh chat had no product path: cross-session reading existed only as an opt-in tool package no shipped preset mounted, and starting a chat was a browser-only gesture the model could neither request nor perform.

## Decision

The `@` menu speaks the `/` menu's icon language. `InputTriggerCandidate` gains an `appearance` field (`'session' | 'file' | 'folder'`, the same union `ReferenceInsert` already uses), and `MenuView` renders the domain glyph in place of the text prefix for candidates that set it. The ui-reference source stops composing `File ·`/`Folder ·`/`Session ·` labels and tags each row instead; the folder/file/chat glyphs are the same ones the composer's landed-reference decorations render, so a row and the token it inserts now carry identical marks.

Cross-session reading ships by default: the `standard`, `code`, and `cordis` agent presets (both app copies) mount `@deepseek-ai/dsh-tool-session-query`, whose six tools already authorize every read against the calling session's workspace and bound their output. The Web bundle's `session-query-sqlite` row moves from `openAt: never` to `first-search`, so the per-session search tools are callable while host boot still imports no node:sqlite.

Starting a chat is a model-facing tool: the new host-plane `@deepseek-ai/dsh-tool-session-start` registers `create_session`, mounted only by the shipped web-app bundle. The tool derives the target from the calling session — the registered workspace accounting it, else its recorded cwd, plus its preset composition (`inheritPreset` config, default `true`) — and asks the approval seam BEFORE calling the gateway, so a chat birth happens only behind an explicit user confirmation. Creation itself goes through `ctx.apiProxy.sessions.create`, the same path the browser's New Session button drives; the gateway's `ensureSession` dedup and `host/session-added` frame mean the sidebar learns of the tool-created chat exactly like a UI-created one. Subagent callers are refused (only a top-level chat can start another chat), a missing approval service refuses instead of degrading, and any non-grant outcome produces an error result with no session created.

## Alternatives considered

**Icons as vendor strings in candidate `icon` fields.** Rejected: `icon` is a free-form string seat, so the menu would need a source-by-source glyph mapping anyway; the typed `appearance` union reuses the reference vocabulary, keeps the row and the inserted chip consistent by construction, and leaves `icon` for sources that own bespoke glyphs.

**A dedicated first-message parameter on `create_session`.** Rejected: the gateway's `session.create` accepts no prompt, and queueing one through a second call would race the user opening the chat; the product intent is an empty chat the user writes into, not agent-seeded content.

**Tool-side workspace attachment instead of gateway creation.** Rejected: calling `ctx.agents.create` directly would fork the session-creation path, bypassing the gateway's preset conflict checks, cwd conflict dedup, and the `host/session-added` stream — three behaviors the browser already depends on and a second path would silently diverge from.

**Silent creation with a post-hoc notice.** Rejected: a new sidebar row is a user-visible surface mutation outside the tool-result card, so it rides the approval seam rather than `agent.inject` context; the approval ask is also the natural place to tell the user which workspace the chat will appear in.

## Consequences

The two trigger menus share one visual grammar, and the former label vocabulary is gone from the `reference` locale namespace (`candidate.file`/`candidate.folder`/`candidate.session` removed with their README claims). Every shipped Web agent can now search and read prior sessions in its own workspace without a deployment opting in, at the cost of the ephemeral SQLite index opening on the first search rather than never. Agents can start chats for users only through an approval-gated, Web-mounted tool that neither navigates the user nor carries history over — task delegation stays with the subagent tools, and the tool description says so.

The pre-existing web e2e goldens and component specs asserting the `File ·`/`Session ·` prefixes were updated with the behavior; `apps/web/tests/reference-composer.e2e.ts` now asserts rows by name and glyph count, and the menu golden carries no prefix text.
