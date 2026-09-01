/** Page-provided request parameters for the browser HTTP and WebSocket carriers. */

interface RequestAuthGlobal {
  __DSH_REQUEST_AUTH__?: {
    /** Query parameters copied onto every connection request. */
    readonly query: Readonly<Record<string, string>>
  }
}

/**
 * Apply request parameters installed by the served page before client boot.
 * The returned URL is a copy when parameters exist; callers may otherwise use
 * the original URL unchanged.
 * @param input - connection request URL.
 * @returns URL carrying the page-provided request parameters.
 */
export function withPageRequestAuth(input: URL): URL {
  const query = (globalThis as RequestAuthGlobal).__DSH_REQUEST_AUTH__?.query
  if (query === undefined) return input
  const authenticated = new URL(input)
  for (const [name, value] of Object.entries(query)) {
    authenticated.searchParams.set(name, value)
  }
  return authenticated
}
