# Agent Note: Turn-error details disclosure and full diagnostic copy

Status: implemented

English | [中文](2026-08-24-turn-error-details-and-full-copy.zh.md)

## Problem

A terminal turn error rendered an inline message and optional code badge, but lacked an expandable inspection view for detailed diagnostics (such as HTTP status codes, request identifiers, or long error responses). Furthermore, the copy icon copied only the isolated message string, omitting the error code (e.g. `PI_AI_ERROR`) and contextual metadata required for bug diagnosis.

## Decision

1. The `turn-error` chat node gains an inline **Details** disclosure toggle button in its action strip beside **Retry** and Copy.
2. Clicking the details button expands a structured panel displaying the error code, full error message, HTTP status code, and request identifier when available.
3. The copy action payload is formatted with the complete diagnostic string (`${code}: ${message}` along with HTTP status and request ID if present) so copying preserves actionable diagnostic context.
4. `TurnErrorNode` in `@deepseek-ai/dsh-client-runtime` and `turnErrorDefinition` in `@deepseek-ai/dsh-client-ui-conversation` forward optional `status` and `requestId` from `match.event.data.reason.error`.

## Alternatives considered

**Modal or drawer dialog for error details** — rejected: inline expandable disclosure is lightweight, keeps spatial context with the failed turn, and matches the pattern established by `model-retry`.

**Overwriting the single-line summary with the full verbose stack** — rejected: keep the initial status row compact and display-safe while allowing on-demand expansion.

## Consequences

- `TurnErrorNode` carries optional `status` and `requestId` fields.
- Copy actions produce full diagnostic strings for bug reports.
- Localization dictionaries in `ui-conversation` include `message.turnError.details`, `message.turnError.hideDetails`, and detail labels.
- Test coverage in `chat-view.client.spec.tsx` and `conversation-node-definitions.client.spec.ts` verifies details toggling, formatted copy output, and metadata forwarding.
