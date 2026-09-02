/**
 * Wire types for the Firecrawl search API (`POST https://api.firecrawl.dev/v1/search`).
 * Types only — no runtime code. Firecrawl returns a flat `data[]`; each entry
 * may carry a URL, title, and description (raw result mode).
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl/types
 */

/** Request body sent to Firecrawl's search endpoint (raw result mode is the default). */
export interface FirecrawlSearchRequest {
  query: string
  /** Firecrawl's result-count control; the seam still enforces the bound on return. */
  limit?: number
}

/** One entry of Firecrawl's flat `data[]`. */
export interface FirecrawlSearchResult {
  url?: string | null
  title?: string | null
  description?: string | null
}

/** Firecrawl's search response envelope. */
export interface FirecrawlSearchResponse {
  success?: boolean
  data?: FirecrawlSearchResult[]
  warning?: string | null
}

/** Firecrawl's error response envelope (best-effort; fields vary by failure). */
export interface FirecrawlError {
  error?: string
  message?: string
}
