import { EventEmitter } from 'node:events'
import type { LookupFunction } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLinkTitle } from '../src/link-title.ts'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn<(
  url: URL,
  options: { lookup: LookupFunction; headers: Record<string, string> },
  callback: (response: IncomingMessage) => void,
) => EventEmitter & { end: () => void }>() }))
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }))
vi.mock('node:http', () => ({ request: mocks.request }))
vi.mock('node:https', () => ({ request: mocks.request }))

function respond(body: string, statusCode = 200, headers: Record<string, string> = { 'content-type': 'text/html' }) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    // A connect-time DNS lookup must return the already validated address.
    options.lookup('ignored.example', {}, (error, address, family) => {
      expect(error).toBeNull(); expect(address).toBe('93.184.216.34'); expect(family).toBe(4)
    })
    const request = new EventEmitter() as EventEmitter & { end: () => void }
    request.end = () => {
      const response = Object.assign(new PassThrough(), { statusCode, headers })
      callback(response as unknown as IncomingMessage)
      response.end(body)
    }
    return request
  })
}

beforeEach(() => { vi.resetAllMocks(); mocks.lookup.mockResolvedValue({ address: '93.184.216.34', family: 4 }) })

describe('public page title lookup', () => {
  it('reads the title only and pins DNS without forwarding credentials', async () => {
    respond('<html><head><title>  Example &amp; docs </title></head></html>')
    expect(await resolveLinkTitle('https://example.com/docs', new AbortController().signal)).toBe('Example &amp; docs')
    expect(mocks.request.mock.calls[0]?.[1].headers).toEqual({ accept: 'text/html', 'accept-encoding': 'identity' })
  })
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.0.1'])('refuses private and local address %s', async (address) => {
    mocks.lookup.mockResolvedValue({ address, family: 4 })
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it.each(['file:///etc/passwd', 'https://user:password@example.com', 'http://example.com:4317', 'http://[::1]/', 'not a url'])('refuses %s', async (url) => {
    expect(await resolveLinkTitle(url, new AbortController().signal)).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('revalidates a redirect before connecting', async () => {
    respond('', 302, { location: 'http://localhost/internal' })
    mocks.lookup.mockResolvedValueOnce({ address: '93.184.216.34', family: 4 }).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('follows a public redirect and bounds response bytes', async () => {
    respond('', 302, { location: '/next' }); respond('<title>Next</title>')
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBe('Next')
    respond('x'.repeat(262145) + '<title>Too late</title>')
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
  })
  it('does not parse non-HTML downloads or failed pages', async () => {
    respond('<title>Fake</title>', 200, { 'content-type': 'application/pdf' })
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
    respond('<title>Missing</title>', 404)
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
  })
  it('returns no title for network failure or cancellation', async () => {
    mocks.lookup.mockRejectedValue(new Error('DNS unavailable'))
    expect(await resolveLinkTitle('https://example.com/', new AbortController().signal)).toBeNull()
    const controller = new AbortController(); controller.abort()
    expect(await resolveLinkTitle('https://example.com/', controller.signal)).toBeNull()
  })
})
