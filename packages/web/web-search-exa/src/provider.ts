/**
 * `ExaSearchProvider`: a `WebSearchProvider` backed by the Exa search API (`POST /search` with
 * highlight contents). It maps the first non-blank highlight to `snippet`, maps
 * `publishedDate` to `publishedAt`, drops entries without a snippet, and omits `content`
 * because Exa returns no generated answer.
 * @module @deepseek-ai/dsh-web-search-exa/provider
 */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { ExaError, ExaResult, ExaSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const EXA_PROVIDER_ID = 'exa'

/** Default Exa search endpoint; `/search` is the operation. */
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai'

/** Default retrieval mode: let Exa pick between keyword and neural search. */
export const EXA_DEFAULT_SEARCH_TYPE = 'auto'

/** Default number of highlight sentences requested per result. */
export const EXA_DEFAULT_HIGHLIGHTS_PER_RESULT = 1

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface ExaSearchProviderOptions {
  /** Literal Exa API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Exa API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Retrieval mode sent as Exa's `type`. */
  searchType: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. */
  numResults?: number
  /** Highlight sentences requested per result (Exa's `highlightsPerUrl`). */
  highlightsPerResult: number
}

/**
 * Map one Exa result to a normalized source, or `undefined` when it carries no
 * portable snippet (an entry with no highlight is dropped — the seam has no
 * other field to derive a snippet from, and inventing one would lie).
 *
 * @param result - one entry of Exa's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank highlight.
 */
export function mapExaResult(result: ExaResult): WebSearchSource | undefined {
  const snippet = result.highlights?.find(highlight => highlight.trim().length > 0)
  if (snippet === undefined) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Map an Exa response envelope to a normalized search result.
 *
 * @param response - the parsed `POST /search` response body.
 * @returns the normalized result; snippet-less entries are dropped
 *   ({@link mapExaResult}).
 */
export function mapExaResponse(response: ExaSearchResponse): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapExaResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  // Exa returns no generated answer, so `content` is omitted. The web service owns the
  // final `maxResults` truncation, so this provider reports `truncated: false`.
  return { sources, truncated: false }
}

/** The Exa-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = EXA_PROVIDER_ID

  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two sections. A
   * thunk rather than a value because the plugin's settings section can change
   * between searches, and re-registering the provider to carry a new endpoint
   * would make the seam's selection observable to the user as a flicker. A
   * plain options object is accepted for compatibility.
   */
  constructor(resolveOptions: (() => ExaSearchProviderOptions) | ExaSearchProviderOptions) {
    this.resolveOptions = typeof resolveOptions === 'function' ? resolveOptions : () => resolveOptions
  }

  private readonly resolveOptions: () => ExaSearchProviderOptions

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && isValidBaseUrl(options.baseURL)
      && isPositiveInteger(options.highlightsPerResult)
      && (options.numResults === undefined || isPositiveInteger(options.numResults))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    // One snapshot for the whole operation: credential resolution awaits, and a
    // settings write landing inside that await must not send the key resolved
    // from the old section to the endpoint named by the new one.
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    // A per-request bound wins over the configured default; either may be absent.
    const numResults = request.maxResults ?? options.numResults
    let response: Response
    try {
      response = await fetch(`${options.baseURL}/search`, {
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
          type: options.searchType,
          contents: { highlights: { highlightsPerUrl: options.highlightsPerResult } },
          ...numResults !== undefined ? { numResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Exa search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Exa API error (HTTP ${status})`
      try {
        const parsed = await response.json() as ExaError
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
      const payload = await response.json() as ExaSearchResponse
      return mapExaResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Exa returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param options - the caller's snapshot, so the key and the endpoint it is sent to come from one section.
   * @param signal - abort signal for the surrounding search.
   * @returns the resolved key.
   */
  private async apiKey(options: ExaSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.() ?? undefined
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(
        `Exa search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? 'EXA_API_KEY'
    throw new WebError(
      `Exa search has no API key for "${ref}"; store it through the credentials service`
      + ' or export it in the launching environment',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a request limit that can be sent to Exa (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Exa search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
