import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FIRECRAWL_PROVIDER_ID, FirecrawlSearchProvider } from '@deepseek-ai/dsh-web-search-firecrawl'
import * as firecrawlPlugin from '@deepseek-ai/dsh-web-search-firecrawl'
import { mapFirecrawlResponse, mapFirecrawlResult } from '../src/provider.ts'

const options = { apiKey: 'firecrawl-key', baseURL: 'https://api.firecrawl.test' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapFirecrawlResult({
      url: 'https://a.test',
      title: 'A',
      description: 'A description',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'A description' })
  })

  it('drops a result with no URL', () => {
    expect(mapFirecrawlResult({ url: '' })).toBeUndefined()
    expect(mapFirecrawlResult({ url: 'https://a.test', title: null, description: null }))
      .toEqual({ url: 'https://a.test' })
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapFirecrawlResult({ url: 'https://a.test', title: '', description: '' }))
      .toEqual({ url: 'https://a.test' })
    expect(mapFirecrawlResult({ url: 'https://a.test', title: 'T', description: null }))
      .toEqual({ url: 'https://a.test', title: 'T' })
  })

  it('maps a response to a result with no content and filtered sources', () => {
    const result = mapFirecrawlResponse({
      success: true,
      data: [
        { url: 'https://a.test', title: 'A', description: 'one' },
        { url: '' },
        { url: 'https://c.test', description: 'three' },
      ],
    })
    expect(result).toEqual({
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'one' },
        { url: 'https://c.test', snippet: 'three' },
      ],
      truncated: false,
    })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing data array', () => {
    expect(mapFirecrawlResponse({}).sources).toEqual([])
  })
})

describe('FirecrawlSearchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new FirecrawlSearchProvider(() => ({ ...options, apiKey: '' })).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new FirecrawlSearchProvider(() => options).available()).toBe(true)
  })

  it('is available with a resolver instead of a literal key', () => {
    const { apiKey: _literal, ...rest } = options
    expect(new FirecrawlSearchProvider(() => ({ ...rest, resolveApiKey: async () => 'resolved' })).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new FirecrawlSearchProvider(() => ({ ...options, baseURL: 'not a url' })).available()).toBe(false)
  })

  it('is misconfigured when maxResults is not a positive integer', () => {
    expect(new FirecrawlSearchProvider(() => ({ ...options, maxResults: 0 })).available()).toBe(false)
    expect(new FirecrawlSearchProvider(() => ({ ...options, maxResults: 1.5 })).available()).toBe(false)
    expect(new FirecrawlSearchProvider(() => ({ ...options, maxResults: 3 })).available()).toBe(true)
  })
})

describe('FirecrawlSearchProvider search', () => {
  it('posts the query and limit to /v1/search with a bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: [{ url: 'https://a.test', title: 'A', description: 'd' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FirecrawlSearchProvider(() => options)

    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 7 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/v1/search')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer firecrawl-key')
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'DeepSeek Harness', limit: 7 })
    expect(result.sources).toEqual([{ url: 'https://a.test', title: 'A', snippet: 'd' }])
  })

  it('omits the limit when neither the request nor the config names one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FirecrawlSearchProvider(() => options)

    await provider.search({ query: 'q' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'q' })
  })

  it('uses the configured default limit when the request carries none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FirecrawlSearchProvider(() => ({ ...options, maxResults: 5 }))

    await provider.search({ query: 'q' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ query: 'q', limit: 5 })
  })

  it('resolves the key through the resolver per operation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const resolver = vi.fn(async () => 'resolved-key')
    const { apiKey: _literal, ...rest } = options
    const provider = new FirecrawlSearchProvider(() => ({ ...rest, resolveApiKey: resolver }))

    await provider.search({ query: 'q' })

    expect(resolver).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer resolved-key')
  })

  it('fails as WEB_PROVIDER_CREDENTIAL_MISSING without any key', async () => {
    const provider = new FirecrawlSearchProvider(() => ({ ...options, apiKey: '', resolveApiKey: async () => undefined }))
    await expect(provider.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('surfaces non-2xx responses as WEB_PROVIDER_ERROR with the API detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, headers: { 'content-type': 'application/json' } })))
    const provider = new FirecrawlSearchProvider(() => options)
    await expect(provider.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'rate limited' })
  })

  it('reports an abort as WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      controller.abort()
      const reason: unknown = init.signal?.reason
      return Promise.reject(reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError'))
    }))
    const provider = new FirecrawlSearchProvider(() => options)
    await expect(provider.search({ query: 'q' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('snapshots options at operation entry so a later settings write cannot mix key and endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    let optionsAtCall = { ...options, apiKey: 'first' }
    const provider = new FirecrawlSearchProvider(() => optionsAtCall)

    const search = provider.search({ query: 'q' })
    optionsAtCall = { ...options, apiKey: 'second' }
    await search

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer first')
  })
})

describe('web-search-firecrawl plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'firecrawl-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in firecrawlPlugin).toBe(false)
  })

  it('threads maxResults config into the request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'firecrawl-key', maxResults: 9 })
    await ctx.web.search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ query: 'q', limit: 9 })
    await fiber.dispose()
  })

  it('falls back to $FIRECRAWL_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://api.firecrawl.dev/v1/search')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('fails searches with WEB_PROVIDER_CREDENTIAL_MISSING when neither config nor env supplies a key', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: FIRECRAWL_PROVIDER_ID })
      await ctx.plugin(firecrawlPlugin, {})
      await expect(ctx.web.search({ query: 'q' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })
})
