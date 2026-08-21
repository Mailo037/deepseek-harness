# Agent Note: Web search card selects the answer provider (DeepSeek/Exa/Perplexity/Firecrawl)

Status: implemented

English | [中文](2026-08-21-web-search-provider-selection.zh.md)

## Problem

The web capability seam (`ctx.web`) already auto-selects a search provider, but the product shipped exactly one implementation (`web-search-deepseek`) and the Web Search card was hard-wired to it: there was no way to answer searches with another provider such as Exa or Firecrawl, and no in-app surface to switch backends.

## Decision

The seam's selection becomes mutable and user-owned. `WebRuntime` now exposes `setSearchProvider`/`setFetchProvider` and installs its own settings namespace `web-search` (schema = `WebRuntimeConfig`), with the composition entry plus the env-var overrides as the `base` layer. A persisted `web-search.searchProvider` value re-pins the selection live on commit — no provider re-registration, no flicker, and the seam's per-search resolution rules (configured id wins, else auto-select, else the `WEB_PROVIDER_*` taxonomy) are unchanged. The card binds a second scope to that namespace and renders a provider select.

Three provider packages now speak the same settings+credentials language the DeepSeek provider established. `web-search-exa` and `web-search-perplexity` were refactored from env-at-registration to the thunk pattern: each installs its own settings namespace, resolves its key per search through the credentials domain (`EXA_API_KEY`/`PERPLEXITY_API_KEY`) with the environment as fallback, and accepts either a thunk or a plain options object (compatibility). A new `web-search-firecrawl` package registers the Firecrawl provider (`firecrawl`, `POST /v1/search`, raw result mode; `description` → `snippet`, URL-less entries dropped) on the same pattern. The base bundle mounts all four providers, keeping `searchProvider: deepseek-official` as the default.

The card's key control is provider-aware: it writes the selected provider's credential reference (the DeepSeek section's `apiKeyEnv` still wins for DeepSeek) and its hint names the reference being addressed.

## Alternatives considered

**A dedicated `web-search-select` plugin owning the section.** Rejected: the seam already owns its selection config and env-var overrides; keeping the section beside them avoids a second "priority chain" to document.

**Leave Exa/Perplexity env-only and gate the key field per provider.** Rejected: the card's key control would write a credential the selected provider never reads — a silent misconfiguration.

**Full thunk refactor of Exa/Perplexity with no compat path.** Rejected in favor of the union constructor: existing direct-construction call sites (tests, e2e) keep working while the plugin path projects the section per search.

## Consequences

The Web Search card now selects the answer provider and addresses the right key. Searches pick the stored provider from the next request on; providers without a key fail with `WEB_PROVIDER_CREDENTIAL_MISSING` instead of being silently unavailable, matching the DeepSeek provider's registration semantics (availability is config-shape-based; the key is a per-search concern). `web-search-deepseek` remains the composition default, so existing deployments keep their behavior.

## Testing

New seam tests cover live re-pinning via `setSearchProvider`, the `web-search` settings section (stored selection served without re-registration, fallback to the composition layer on settings-provider detach, namespace release on unload). Firecrawl has mapping/availability/search/registration/settings-section tests and a real-API e2e that self-skips without `$FIRECRAWL_API_KEY`. Exa/Perplexity suites were updated for the credential semantics. Card tests cover the provider select's options and staging, the provider-aware key hint, and the selection-scope save. The full repository build (`pnpm run build`) passes.
