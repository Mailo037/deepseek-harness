/**
 * Shared endpoint-selection helpers used by both the GUI probe and the device
 * channel. Pure functions over stored origins; the module must stay
 * side-effect-free so it is trivially unit-testable in Node.
 */

/** Canonical origin of an endpoint (scheme + host + port), or null when invalid. */
export function normalizeEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

/** Whether an endpoint is recognizable as a Tailscale address. */
export function isTailscaleEndpoint(endpoint: string): boolean {
  const normalized = normalizeEndpoint(endpoint)
  if (normalized === null) return false
  const hostname = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname.endsWith('.ts.net') || hostname.startsWith('fd7a:115c:a1e0:')) return true
  const ipv4 = hostname.split('.').map(part => Number(part))
  return ipv4.length === 4
    && ipv4.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && ipv4[0] === 100
    && ipv4[1] >= 64
    && ipv4[1] <= 127
}

/** Whether a hostname is a loopback alias (meaningless from the phone). */
export function isLoopbackHostname(hostname: string): boolean {
  // URL.hostname keeps the brackets on IPv6 literals; compare the bare form.
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return bare === '127.0.0.1' || bare === '::1' || bare === 'localhost'
}

/**
 * Normalize and dedupe an ordered endpoint list from the QR payload, dropping
 * loopback aliases that can only mean the phone's own loopback.
 */
export function endpointsOf(endpoints: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const endpoint of endpoints) {
    const origin = normalizeEndpoint(endpoint)
    if (origin === null) continue
    const hostname = new URL(origin).hostname
    if (isLoopbackHostname(hostname)) continue
    if (seen.has(origin)) continue
    seen.add(origin)
    out.push(origin)
  }
  return out
}

/**
 * Candidate origins to try first: the last-successful origin, then the rest of
 * the stored list in their stored order. Deduplicated.
 */
export function selectCandidates(endpoints: string[], lastSuccessfulUrl?: string): string[] {
  const list = lastSuccessfulUrl !== undefined
    ? [lastSuccessfulUrl, ...endpoints.filter(endpoint => endpoint !== lastSuccessfulUrl)]
    : [...endpoints]
  return [...new Set(list)]
}
