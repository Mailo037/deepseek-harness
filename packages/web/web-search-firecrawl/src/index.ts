/**
 * `@deepseek-ai/dsh-web-search-firecrawl`: registers a Firecrawl-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-web-search-exa` does. The key is owned by
 * `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  FirecrawlSearchProvider,
} from './provider.ts'
import type { FirecrawlSearchProviderOptions } from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_PROVIDER_ID,
  FirecrawlSearchProvider,
} from './provider.ts'
export type { FirecrawlSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'FIRECRAWL_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Firecrawl API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `FIRECRAWL_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/v1/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string(),
  maxResults: z.number().step(1).min(1),
})

/** Settings namespace carrying this provider's endpoint and key reference. */
export const WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE = settingsNamespace('web-search-firecrawl')

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): FirecrawlSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get('FIRECRAWL_BASE_URL')?.value
      ?? FIRECRAWL_DEFAULT_BASE_URL,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
  }
}

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_FIRECRAWL_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider(() => resolveOptions(ctx, current())))
}
