/** The `web-search-firecrawl` settings section layered over the composition entry. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as firecrawlPlugin from '@deepseek-ai/dsh-web-search-firecrawl'
import { WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web-search-firecrawl'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; pluginFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(firecrawlPlugin, { apiKey: 'fc-key', baseURL: 'https://search.entry.test' })
  await pluginFiber.await()
  return { ctx, settingsFiber, pluginFiber }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Run one search and answer the endpoint it reached. A fresh `Response` per
 * call because a body can only be read once, and the call history is cleared
 * because repeated `spyOn` returns the same spy.
 * @param ctx - context whose `ctx.web` serves the search.
 * @returns the URL the provider fetched.
 */
async function searchOnce(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse({ success: true, data: [] })))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

describe('web-search-firecrawl settings section', () => {
  it('serves a stored endpoint to the next search without re-registering the provider', async () => {
    const bench = await boot()
    expect(await searchOnce(bench.ctx)).toContain('https://search.entry.test')

    await bench.ctx.settings.update(WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })

    expect(await searchOnce(bench.ctx)).toContain('https://search.stored.test')
    await bench.ctx.fiber.dispose()
  })

  it('keeps the literal key out of every described layer', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE, { apiKey: 'fc-stored-secret' })

    const [descriptor] = bench.ctx.settings.describe({ redactSecrets: true })
      .filter(row => String(row.ns) === 'web-search-firecrawl')

    expect(JSON.stringify(descriptor)).not.toContain('fc-stored-secret')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.ctx.settings.update(WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE, {
      baseURL: 'https://search.stored.test',
    })
    expect(await searchOnce(bench.ctx)).toContain('https://search.stored.test')

    await bench.settingsFiber.dispose()

    expect(await searchOnce(bench.ctx)).toContain('https://search.entry.test')
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the plugin unloads', async () => {
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('web-search-firecrawl')

    await bench.pluginFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('web-search-firecrawl')
    await bench.ctx.fiber.dispose()
  })
})
