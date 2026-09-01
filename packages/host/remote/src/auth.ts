/**
 * GUI access-token authentication for the web surface. Every request whose
 * connection did NOT originate on loopback must present the access token;
 * genuine loopback connections stay open so the local browser keeps working
 * without credentials. The token travels as the `dsh_access` cookie, as an
 * `Authorization: Bearer` header, or as the `dsh_token` query parameter. The
 * injected index script retains the URL token for the browser connection
 * carriers because Android WebView does not reliably attach third-party
 * iframe cookies to WebSockets.
 *
 * Loopback is decided by the socket peer address, never by the Host header:
 * once the server binds all interfaces, any LAN client could otherwise spoof
 * `Host: 127.0.0.1` and bypass the token.
 * @module @deepseek-ai/dsh-host-remote/src/auth
 */

import type { IncomingMessage } from 'node:http'

/** Cookie name carrying the access token on browser requests. */
export const ACCESS_COOKIE = 'dsh_access'
/** Query parameter name on the GUI URL the app opens. */
export const ACCESS_QUERY = 'dsh_token'

/**
 * Whether the request's connection originates on loopback (token-free zone).
 * @param request - Incoming browser request.
 * @returns Whether the socket peer is loopback.
 */
export function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Extract the token from the `Authorization` header, if bearer-style. */
function bearerTokenOf(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (header === undefined || !header.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length).trim()
}

/** Extract the token from the `dsh_access` cookie. */
function cookieTokenOf(request: IncomingMessage): string | undefined {
  const cookies = request.headers.cookie
  if (cookies === undefined) return undefined
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === ACCESS_COOKIE) return rest.join('=').trim()
  }
  return undefined
}

/** Extract the token from the `dsh_token` query parameter. */
function queryTokenOf(request: IncomingMessage): string | undefined {
  const url = request.url
  if (url === undefined) return undefined
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  for (const part of query.split('&')) {
    const [name, ...rest] = part.split('=')
    if (name === ACCESS_QUERY) return decodeURIComponent(rest.join('=')).trim()
  }
  return undefined
}

/**
 * Extract the presented token from any supported channel.
 * @param request - Incoming browser request.
 * @returns Presented token, when one exists.
 */
export function presentedTokenOf(request: IncomingMessage): string | undefined {
  return bearerTokenOf(request) ?? cookieTokenOf(request) ?? queryTokenOf(request)
}

/**
 * Whether the request is authorized: loopback requests always pass; every
 * other request must present the configured access token.
 * @param request - the incoming browser request.
 * @param accessToken - the configured GUI access token (empty = auth disabled).
 * @returns Whether the request may access the GUI.
 */
export function isAuthorizedRequest(request: IncomingMessage, accessToken: string): boolean {
  if (isLoopbackRequest(request)) return true
  if (accessToken.length === 0) return true
  const presented = presentedTokenOf(request)
  return presented !== undefined && presented.length > 0 && presented === accessToken
}

/** Inline script injected into index.html: retains `?dsh_token=` for connection requests, sets the fallback cookie, then cleans the URL. */
export const ACCESS_COOKIE_SCRIPT = `<script>
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('${ACCESS_QUERY}');
  var storageKey = 'dsh.request-auth.${ACCESS_QUERY}';
  if (token) {
    try { sessionStorage.setItem(storageKey, token); } catch (storageUnavailable) { void storageUnavailable; }
  } else {
    try { token = sessionStorage.getItem(storageKey); } catch (storageUnavailable) { void storageUnavailable; }
  }
  if (token) {
    window.__DSH_REQUEST_AUTH__ = { query: { '${ACCESS_QUERY}': token } };
    document.cookie = '${ACCESS_COOKIE}=' + encodeURIComponent(token) + '; path=/; SameSite=Lax';
  }
  if (params.has('${ACCESS_QUERY}')) {
    history.replaceState(null, '', location.pathname);
  }
})();
</script>`
