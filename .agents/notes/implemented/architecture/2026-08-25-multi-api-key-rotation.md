# Multi-API-key rotation on quota-classified failures

## Summary

Provider plugins (llm-deepseek, llm-pi-ai) and the Models settings page now support
multiple API keys per provider route. When a request fails with a quota-classified
error (`QUOTA` code — "insufficient balance", "usage limit reached"), the harness
automatically retires the failed key and retries the step with the next configured
key. The decision is bounded by the key count: each failure retires one key, and
the step ends after the last usable key fails.

## Motivation

A single API key may exhaust its usage quota while the user has another key for
the same endpoint (a separate account, a different tier). Previously the only
remedy was to duplicate the provider entry under a different route id, which
fragments the Model tab and requires per-route model configuration. Adding
multiple keys to one provider profile keeps the provider as a single
configuration surface and lets the harness handle the switch transparently.

## Design

### Cooldown, not retry

The mechanism is distinct from the existing `llm-retry` plugin's retry-policy
backoff, which retries a transient failure on the same credential. Key rotation
_addresses a different class of error_: the key is exhausted and will not recover
within the turn, so every subsequent attempt on the same key would also fail.
Instead, the failed key is retired to an in-memory cooldown (default one hour),
and the next request resolves the first non-exhausted key from the configured
list. If every key is in cooldown the first one is still returned (the fallback),
so the provider's real failure surfaces rather than a `MISSING_CREDENTIAL`.

### Where the rotation lives

The decision is split across two roles:

1. **A shared `KeyRotation` helper** (`dsh-llm/src/key-rotation.ts`) — a
   per-provider cooldown registry with injectable clock for determinism in tests.
   Pure decision logic — `pickRotationRef`, `rotateAfterQuotaFailure` — is
   exported as plain functions over this registry.

2. **Per-provider plugin listener** on `agent/request-error` — each provider
   plugin (llm-deepseek, llm-pi-ai) registers its own waterfall listener. On a
   `QUOTA`-coded failure with a known `apiKeyRef` (the credential reference the
   failed request authenticated through), it retires that ref and returns
   `{kind: 'retry'}` while another configured ref remains usable. The retry
   re-runs the agent step, which re-resolves the credential — and the resolver
   picks the first non-exhausted ref.

3. **Per-provider credential resolver** — the resolver picks the next key via
   `pickRotationRef`, filtering out refs currently in cooldown.

### Which failure code triggers rotation

Only the `QUOTA` code (the canonical provider-neutral code for an exhausted
account quota or balance). The existing `isQuotaExceededError` classifier in
`dsh-llm/src/error.ts` recognizes DeepSeek, OpenAI, and generic provider
wording ("insufficient quota", "usage limit reached", "exceeded your current
quota", "balance exhausted", "out of credits"). Rate-limit (429) and server
errors remain under the existing `llm-retry` policy.

### How the adapter reports which key was used

The `LlmFailure` interface and `LlmError` constructor gain an optional
`apiKeyRef` field — the credential reference name (an environment-variable name
like `DEEPSEEK_API_KEY`, never a secret value). Each adapter annotates failed
requests with the ref it resolved:

- `DeepSeekAdapter` sets `apiKeyRef` on all `LlmError` throws from `request()`.
- `PiAiAdapter` patches error finish chunks (`finish.kind === 'error'`) in the
  stream iteration loop.

### The Models tab UI

The `backupApiKeys` field on each provider profile (settings.yaml) carries the
ordered list of additional credential refs. The Model tab's editor shows the
primary key field plus one field per configured backup ref, with an "Add another
key" affordance. Each backup field manages its own derived ref
(`${primaryRef}_2`, `${primaryRef}_3`, …). The cooldown and rotation are
runtime-only — the UI never reads or displays cooldown state.

### What changes in each package

| Package | Change |
|---|---|
| `dsh-llm` | `LlmFailure.apiKeyRef`, `LlmErrorOptions.apiKeyRef`, `normalizeLlmFailure` passthrough, new `key-rotation.ts` |
| `llm-deepseek` | Config: `backupApiKeys`, `apiKeyCooldownMs`; rotation-aware resolver; `agent/request-error` listener; adapter error annotation |
| `llm-pi-ai` | Profile schema: `backupApiKeys`, `apiKeyCooldownMs`; rotation-aware resolver; `agent/request-error` listener; adapter finish-chunk annotation |
| `ui-settings-models` | Store reads `backupApiKeys`; editor shows multi-key fields; delete flow unsets page-managed backups |

## Alternatives considered

### Adapter-internal retry loop

The DeepSeek adapter already has a `while (true)` loop for stale-file-id retries.
Extending it to also handle key rotation would keep the mechanism entirely
self-contained. However, the decision to switch keys is a credential policy, and
the adapter's docstring says "the registering plugin owns validation, layering,
and credential policy". The generic `agent/request-error` waterfall separates
concerns cleanly.

### Exclusive llm-retry integration

The rotation could live in the `llm-retry` plugin, which already handles the
`agent/request-error` waterfall. But `llm-retry` does not own provider
configuration (key lists, cooldown settings), and making it aware of per-route
credential refs would couple it to each provider plugin's schema. The per-plugin
listener approach keeps each provider's config local.

## Verification

1. **Unit tests**: `KeyRotation` (mark/usable/expiry/fallback), `rotateAfterQuotaFailure`
   (retry vs terminal decisions), `pickRotationRef` (skip vs fallback).
2. **Adapter-level tests**: `LlmError` apiKeyRef construction + normalization,
   DeepSeek adapter error annotation, pi-ai adapter finish-chunk annotation.
3. **Plugin-level tests**: `agent/request-error` listener fires `retry` for quota
   on the correct provider and `terminal` after all keys are exhausted.
4. **Resolution tests**: After a listener retires a key, the next stream call
   resolves the backup key (verified by Authorization header).
5. **Real-composition test**: Full Loader boot with session, agent-loop, and
   llm-deepseek; a single agent step recovers from a quota error by switching
   to the backup key.
6. **UI component tests**: Add/backup fields, remove unsets credential, keep
   untouched configured slot, hint text, derived ref collision avoidance.