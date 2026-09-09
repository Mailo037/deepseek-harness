# Agent Note: Transcript link tokens

Status: implemented

English | [中文](2026-09-08-transcript-link-tokens.zh.md)

## Problem

Long raw URLs interrupt transcript reading, and browsers cannot directly fetch titles from most remote sites.

## Decision

Literal user messages and Markdown assistant messages share a compact HTTP(S) token renderer. Website tokens show a favicon and a title, retaining an authored label or hostname when preview metadata is unavailable. File tokens show a basename and an extension-specific glyph; configuration files use a gear and PDFs use a PDF badge. Destinations and logged source text remain unchanged.

The existing Host API carries title-only preview requests so browsers do not need cross-origin HTML access or a third-party preview service. Every redirect gets public-address validation and a pinned DNS result. Response bytes, redirects and elapsed time are bounded. The conversation owner caches request promises; the renderer ignores stale completions after its URL changes.

## Alternatives considered

Browser-only page fetching cannot read ordinary cross-origin page titles. A third-party metadata service would disclose transcript URLs to another operator. Rendering HTML previews would add unnecessary active-content and resource-fetching behavior.

## Consequences

Titles depend on reachable public websites. Failed previews retain the original label or hostname; the log keeps the authored message.

## Verification

Component coverage checks both message directions, destination preservation, title fallback, stale completions, file classification and favicon failure. Host coverage checks public DNS pinning, private destinations, redirects, response limits and failure handling. The assembled keyless browser scenario records both message directions and checks token widths at desktop and mobile viewport sizes.
