/**
 * `@deepseek-ai/dsh-web-search-perplexity`: registers a Perplexity-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-web-search-perplexity
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { PerplexitySearchProvider, PERPLEXITY_DEFAULT_BASE_URL, PERPLEXITY_DEFAULT_MAX_TOKENS, PERPLEXITY_DEFAULT_MODEL } from './provider.ts'
import type { PerplexitySearchProviderOptions } from './provider.ts'

export {
  PERPLEXITY_DEFAULT_BASE_URL,
  PERPLEXITY_DEFAULT_MAX_TOKENS,
  PERPLEXITY_DEFAULT_MODEL,
  PERPLEXITY_PROVIDER_ID,
  PerplexitySearchProvider,
} from './provider.ts'
export type { PerplexityRecency, PerplexitySearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-perplexity'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'PERPLEXITY_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Perplexity API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `PERPLEXITY_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  maxTokens: z.number().step(1).min(1),
  searchRecency: z.union(['day', 'week', 'month', 'year'] as const),
})

/** Settings namespace carrying this provider's endpoint and key reference. */
export const WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE = settingsNamespace('web-search-perplexity')

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(ctx: Context, config: Config): PerplexitySearchProviderOptions {
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
      ?? launchEnvironmentOf(ctx).get('PERPLEXITY_BASE_URL')?.value
      ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: config.model ?? PERPLEXITY_DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? PERPLEXITY_DEFAULT_MAX_TOKENS,
    ...config.searchRecency !== undefined ? { searchRecency: config.searchRecency } : {},
  }
}

/** Register the Perplexity search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_PERPLEXITY_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // The registration carries no resolved value: the provider projects the
    // section per search, so a committed change needs no re-registration.
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new PerplexitySearchProvider(() => resolveOptions(ctx, current())))
}
