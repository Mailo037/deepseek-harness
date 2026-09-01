# Agent Note: Remote devices secrets stay masked until an explicit reveal

Status: implemented

English | [中文](2026-08-26-remote-settings-secret-reveal.zh.md)

## Problem

The Remote devices settings section rendered two secrets in clear text: the pairing QR payload (`pairingCreate` returns the raw JSON string, which embeds the one-time pairing token and the persistent GUI access token) and the access-token group under the paired-device list. Both were visible to anyone watching the screen or a screen share from the moment the card opened, and the hover `title` attributes carried the full strings even if styling were changed afterwards. The product ask (2026-08-26) is to hide both behind an explicit reveal affordance.

## Decision

Both payload spans render a fixed placeholder `SECRET_MASK = '•'.repeat(16)` until their own show button flips a component-local flag. The fixed width keeps the placeholder from leaking the real length of a token or payload, and the `title` attribute carries the clear value only while revealed, closing the tooltip leak. Each show button toggles into its hide counterpart (`pairingReveal`/`pairingHide` and `accessTokenReveal`/`accessTokenHide` under the `settings.remote` locale namespace). The copy buttons keep working while masked, so copying without displaying stays possible. Generating a fresh pairing code resets its payload to masked, and the access token is fetched once on mount and starts masked on every visit.

## Alternatives considered

**Auto-hide after a timeout.** Rejected: it reintroduces a clear-text window without any deliberate action by the viewer, and the interval would be a hardcoded tunable this repository forbids.

**Disable copy while masked.** Rejected: clipboard use during a screen share is precisely the safe case; cutting it removes real function and buys nothing.

**Model the secret as a password input.** Rejected: these values are read-only reference data, not form fields; a text span plus buttons keeps the section's token stylesheet authoritative.

## Consequences

- Screenshots and screen sharing default to safe unless someone deliberately reveals.
- Reveal state lives in `useState`, so navigating to another settings tab and back resets it; nothing persists it.
- The locale dictionaries gain four keys each side; the `satisfies Record<RemoteLocaleKey, string>` pair forces zh/en together at compile time.

## Testing

`packages/client/ui-remote/tests/components.client.spec.tsx` drives both flows under jsdom: the payload is masked by default, appears through `pairingReveal`, and re-masks through `pairingHide`; the access token follows the same gate through its own keys, including the re-masked state; a freshly generated code never renders unmasked. The suite (3 files, 15 tests) and `tsc -b packages/client/ui-remote/tsconfig.json` are green after the change.
