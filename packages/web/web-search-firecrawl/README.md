# @deepseek-ai/dsh-web-search-firecrawl

English | [中文](README.zh.md)

A [Firecrawl](https://firecrawl.dev)-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls Firecrawl's `POST /v1/search` endpoint in raw result mode and maps the flat `data[]` into the seam's normalized `WebSearchResult`.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-web-search-deepseek`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | `$FIRECRAWL_API_KEY` | Firecrawl API key (literal, or resolved through the credentials domain). Empty/absent makes the provider unavailable. |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | Credential reference resolved for each search. |
| `baseURL` | `https://api.firecrawl.dev` | Endpoint base; `/v1/search` is appended. An unparseable value makes the provider unavailable. |
| `maxResults` | (unset) | Default result count when a request carries no `maxResults`. Unset sends no default. Must be a positive integer. |

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-web-search-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

The provider owns a `web-search-firecrawl` settings section (endpoint and key reference), so the Web settings card and the credentials domain can manage it like the DeepSeek provider.

## Mapping

Firecrawl returns a flat `data[]` and no generated answer, so `content` is omitted. Each result maps to a `WebSearchSource`: `url` ← `url`, `title` ← `title`, `snippet` ← `description`. A URL-less entry is not citeable and is dropped. A request's `maxResults` wins over the configured `maxResults` default and is sent as Firecrawl's `limit` for a cost/latency optimization; the final bound is enforced by the seam. Provider failures (HTTP errors, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; a missing key surfaces as `WEB_PROVIDER_CREDENTIAL_MISSING`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, and descriptions or its exact `Firecrawl search aborted`, `Firecrawl search request failed: <error>`, and `Firecrawl returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers and provider-private fields remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Raw result mode only** — Firecrawl's markdown/search-result-mode contents are not requested; `description` maps to `snippet` when present, so a result without a description is URL-only.
- **Only `limit` is exposed** — Firecrawl's other controls (language, country, recency filters, scrape options) wait on provider-neutral Service Definition fields ([seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)).
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
