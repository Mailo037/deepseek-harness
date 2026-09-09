/** Bounded title-only previews for public HTTP(S) pages; no cookies or ambient credentials. */
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList } from 'node:net'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4')

/**
 * Fetch an HTML title with pinned public IPv4 resolution on every redirect.
 * @param href - Absolute public HTTP(S) URL from the transcript.
 * @param signal - The requesting client's cancellation signal.
 * @returns Encoded HTML title text, or null for unavailable or refused previews.
 */
export async function resolveLinkTitle(href: string, signal: AbortSignal): Promise<string | null> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)])
  try {
    let url = new URL(href)
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.port !== '' || url.hostname.includes(':')) return null
      const resolved = await Promise.race([
        lookup(url.hostname, { family: 4 }),
        new Promise<never>((_, reject) => {
          if (deadline.aborted) { reject(new Error('Link title request aborted', { cause: deadline.reason })); return }
          deadline.addEventListener('abort', () => { reject(new Error('Link title request aborted', { cause: deadline.reason })) }, { once: true })
        }),
      ])
      if (blocked.check(resolved.address, 'ipv4')) return null
      const result = await new Promise<{ title?: string; redirect?: string }>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          signal: deadline,
          headers: { accept: 'text/html', 'accept-encoding': 'identity' },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [{ address: resolved.address, family: 4 }])
            else callback(null, resolved.address, 4)
          },
        }, (response) => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
            resolve(response.headers.location ? { redirect: response.headers.location } : {})
            response.destroy()
            return
          }
          if (response.statusCode !== 200 || !response.headers['content-type']?.includes('text/html')) {
            resolve({}); response.destroy(); return
          }
          let html = ''
          let bytes = 0
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            bytes += Buffer.byteLength(chunk)
            if (bytes > 262144) { resolve({}); response.destroy(); return }
            html += chunk
            const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1]
            if (title !== undefined) {
              resolve({ title: title.replace(/\s+/gu, ' ').trim().slice(0, 512) })
              response.destroy()
            } else if (/<\/head\s*>/iu.test(html)) { resolve({}); response.destroy() }
          })
          response.on('end', () => { resolve({}) })
          response.on('error', reject)
        })
        request.on('error', reject)
        request.end()
      })
      if (!result.redirect) return result.title || null
      url = new URL(result.redirect, url)
    }
  } catch {
    // Invalid URLs, DNS/TLS/HTTP failures and cancelled previews keep the visible fallback.
  }
  return null
}
