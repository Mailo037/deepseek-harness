/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by the Firecrawl
 * search API (`POST /v1/search` in raw result mode). It maps `description` to
 * `snippet`, keeps Firecrawl's title, drops entries without a URL, and omits
 * `content` because Firecrawl returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-firecrawl/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { FirecrawlError, FirecrawlSearchResponse, FirecrawlSearchResult } from './types.ts'

/** Stable id this provider registers under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl search endpoint; `/v1/search` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface FirecrawlSearchProviderOptions {
  /** Literal Firecrawl API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Firecrawl API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/v1/search` is appended. */
  baseURL: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  maxResults?: number
}

/**
 * Map one Firecrawl result to a normalized source, or `undefined` when it
 * carries no URL (a URL-less entry is not citeable).
 *
 * @param result - one entry of Firecrawl's `data[]`.
 * @returns the normalized source, or `undefined` when the entry has no URL.
 */
export function mapFirecrawlResult(result: FirecrawlSearchResult): WebSearchSource | undefined {
  if (result.url == null || result.url.length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.description != null && result.description.length > 0 ? { snippet: result.description } : {},
  }
}

/**
 * Map a Firecrawl response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /v1/search` response body.
 * @returns the normalized result; URL-less entries are dropped
 *   ({@link mapFirecrawlResult}).
 */
export function mapFirecrawlResponse(response: FirecrawlSearchResponse): WebSearchResult {
  const sources = (response.data ?? [])
    .map(mapFirecrawlResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Firecrawl returns no generated answer, so `content` is omitted. The web
  // service owns the final `maxResults` truncation, so this provider reports
  // `truncated: false`.
  return { sources, truncated: false }
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker.
   */
  constructor(private readonly resolveOptions: () => FirecrawlSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && (options.maxResults === undefined || isPositiveInteger(options.maxResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    // A per-request bound wins over the configured default; either may be absent.
    const limit = request.maxResults ?? options.maxResults
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/v1/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          query: request.query,
          ...limit !== undefined ? { limit } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Firecrawl search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Firecrawl API error (HTTP ${status})`
      try {
        const parsed = await response.json() as FirecrawlError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body (normal for gateway 5xx/429s) can only
        // cost a richer provider message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as FirecrawlSearchResponse
      return mapFirecrawlResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: FirecrawlSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.() ?? undefined
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Firecrawl search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'FIRECRAWL_API_KEY'
    throw new WebError(
      `Firecrawl search has no API key for "${ref}"; store it through the credentials service`
      + ' or export it in the launching environment',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Firecrawl search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a result limit that can be sent to Firecrawl (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
