# Agent Note: Web composer slash tokens from typed lexicon domains

Status: implemented

English | [中文](2026-08-23-web-composer-slash-token-lexicon.zh.md)

## Problem

After picking a skill or command from the `/` menu, the composer draft showed the landed `/name` token as bare colored text with no domain mark, and hand-typed command names got no decoration at all — only skills implemented the slash pipeline's `lexicon` hook. A reader could not tell a skill token, a command claim, and ordinary text apart at a glance.

## Decision

A lexicon roll member is now either a bare string or `{ name, appearance }`, where `appearance` is `'skill' | 'command'`. The ui-skill source tags its catalog entries `skill`; the `/` command source implements the lexicon hooks for the first time, answering resolvable host commands plus currently-available contributions tagged `command`, with settlement notifications riding new `CommandDirectory.snapshot`/`onSettle` members. The decoration scan maps each matched token to its domain appearance and renders a glyphed capsule (`ReferenceIcon` gains `skill` and `command` kinds); a name shared between sources resolves its appearance to `command`, matching adjudication precedence. The claimed command token keeps its warn highlight but gains the same leading glyph.

This extends the plain-text-reference decision ([web input machine and slash pipeline](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md)) without changing any serialization: picks still land literal text, and the prompt ships the same literal.

## Alternatives considered

**Structured reference occurrences for commands.** Rejected: commands already own their lifecycle through claims and popups; occurrence identity would add deletion and replay machinery no current consumer needs.

**Deriving the domain in the composer from known names.** Rejected: the composer cannot distinguish a skill from a command by shape alone, and hardcoding name lists there would duplicate the sources' catalogs.

## Consequences

Skills and commands read as distinct tokens in the draft and stay visually consistent between menu pick and hand typing. The lexicon contract widened in place, so existing bare-string rolls remain valid. Package tests pin the command roll's cold/warm axis, contribution availability filtering, and settlement fan-out.
