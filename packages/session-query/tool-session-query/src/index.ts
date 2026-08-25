/**
 * Model-facing, workspace-authorized session-history search, summary, and read tools.
 *
 * @module @deepseek-ai/dsh-tool-session-query
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { toolInput } from './input.ts'
import { operations } from './operations.ts'
import { presentation } from './presentation.ts'
import { boundModelText, redactModelText } from './redaction.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-session-query'

/** Capability services required by the model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

/** Default maximum number of authorized search hits returned by one call. */
export const DEFAULT_MAX_SEARCH_RESULTS = 100

/** Default cooperative deadline for either full-text search tool. */
export const DEFAULT_SEARCH_TIMEOUT_MS = 30_000
/** Default maximum UTF-8 bytes in one complete model-visible tool result. */
export const DEFAULT_MAX_RESULT_BYTES = 64 * 1024
/** Default maximum number of repeated summary evidence entries. */
export const DEFAULT_SUMMARY_MAX_ITEMS = 12
/** Default maximum text span from one summary evidence entry. */
export const DEFAULT_SUMMARY_MAX_EVIDENCE_CHARACTERS = 400

/** Deployment-owned search count and timeout bounds. */
export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Maximum UTF-8 bytes in one complete redacted tool result. Defaults to 65536. */
  maxResultBytes?: number
  /** Maximum evidence entries in one repeated Session-summary section. Defaults to 12. */
  summaryMaxItems?: number
  /** Maximum characters from one Session-summary evidence record. Defaults to 400. */
  summaryMaxEvidenceCharacters?: number
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  searchTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_SEARCH_TIMEOUT_MS),
  maxResultBytes: z.number().step(1).min(64).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RESULT_BYTES),
  summaryMaxItems: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_SUMMARY_MAX_ITEMS),
  summaryMaxEvidenceCharacters: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_SUMMARY_MAX_EVIDENCE_CHARACTERS),
})

interface ResolvedConfig {
  readonly maxSearchResults: number
  readonly searchTimeoutMs: number
  readonly maxResultBytes: number
  readonly summaryMaxItems: number
  readonly summaryMaxEvidenceCharacters: number
}

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

const PROMPT_TEXT =
  'Use session_search to find relevant work from prior sessions, or session_event_search to search earlier '
  + 'events in one session. Search results are cursor-free and workspace-scoped. Use session_summary for a '
  + 'bounded event-backed overview of an authorized session. Follow a useful hit with '
  + 'session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.'

/** Register all six tools and their shared model guidance. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const finalizeContent = (result: { readonly content: readonly ContentBlock[] }): ContentBlock[] | undefined => {
    if (result.content.length !== 1 || result.content[0]?.type !== 'text') return undefined
    return [{ type: 'text', text: boundModelText(redactModelText(result.content[0].text), resolved.maxResultBytes) }]
  }
  ctx.systemPrompt.section({
    name: 'tool:session-query',
    order: 113,
    text: PROMPT_TEXT,
  })

  ctx.tools.register(defineTool({
    name: 'session_search',
    description: 'Search prior sessions in the caller workspace and return the strongest matching event from each session.',
    parameters: toolInput.sessionSearchParameters,
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeSessionSearch(ctx, args, exec, resolved.maxSearchResults),
    presentCall: presentation.presentSessionSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_search',
    description: 'Search prior events in one authorized session; the current session excludes the step performing this call.',
    parameters: toolInput.eventSearchParameters,
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    timeoutMs: resolved.searchTimeoutMs,
    execute: (args, exec) => operations.executeEventSearch(ctx, args, exec, resolved.maxSearchResults),
    presentCall: presentation.presentEventSearchCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_summary',
    description: 'Read an authorized Session as a bounded event-backed summary of its objective, explicit decisions, observed changed files, and open todos.',
    parameters: toolInput.targetSessionParameter,
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeSessionSummary(ctx, args, exec, {
      maxItems: resolved.summaryMaxItems,
      maxEvidenceCharacters: resolved.summaryMaxEvidenceCharacters,
    }),
    presentCall: args => presentation.presentSessionSummaryCall(args),
  }))

  ctx.tools.register(defineTool({
    name: 'session_trace',
    description: 'Read the authorized session lineage around one session, including complete visible ancestor and descendant relationships.',
    parameters: toolInput.targetSessionParameter,
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeSessionTrace(ctx, args, exec),
    presentCall: presentation.presentSessionTraceCall,
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_trace',
    description: 'Read every direct replacement and relationship to a cited source event for one event in an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
    },
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventTrace(ctx, args, exec),
    presentCall: args => presentation.presentEventTargetCall('Trace event', args),
  }))

  ctx.tools.register(defineTool({
    name: 'session_event_read',
    description: 'Read one target event and optional neighboring raw-event summaries from an authorized session.',
    parameters: {
      ...toolInput.targetSessionParameter,
      seq: { type: 'integer', required: true, description: 'Target event sequence number.' },
      before: { type: 'integer', description: 'Number of preceding raw events to summarize. Omit for none.' },
      after: { type: 'integer', description: 'Number of following raw events to summarize. Omit for none.' },
    },
    output: TEXT_OUTPUT,
    finalizeContent: (_exec, result) => finalizeContent(result),
    isConcurrencySafe: () => true,
    execute: (args, exec) => operations.executeEventRead(ctx, args, exec),
    presentCall: args => presentation.presentEventTargetCall('Read event', args),
  }))
}

function resolveConfig(config: Config): ResolvedConfig {
  const maxSearchResults = config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS
  const searchTimeoutMs = config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS
  const maxResultBytes = config.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES
  const summaryMaxItems = config.summaryMaxItems ?? DEFAULT_SUMMARY_MAX_ITEMS
  const summaryMaxEvidenceCharacters = config.summaryMaxEvidenceCharacters
    ?? DEFAULT_SUMMARY_MAX_EVIDENCE_CHARACTERS
  if (!Number.isSafeInteger(maxSearchResults) || maxSearchResults < 1) {
    throw new TypeError('tool-session-query: maxSearchResults must be a positive safe integer')
  }
  if (!Number.isInteger(searchTimeoutMs) || searchTimeoutMs < 1 || searchTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(
      `tool-session-query: searchTimeoutMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (!Number.isSafeInteger(maxResultBytes) || maxResultBytes < 64) {
    throw new TypeError('tool-session-query: maxResultBytes must be a safe integer of at least 64')
  }
  if (!Number.isSafeInteger(summaryMaxItems) || summaryMaxItems < 1) {
    throw new TypeError('tool-session-query: summaryMaxItems must be a positive safe integer')
  }
  if (!Number.isSafeInteger(summaryMaxEvidenceCharacters) || summaryMaxEvidenceCharacters < 1) {
    throw new TypeError('tool-session-query: summaryMaxEvidenceCharacters must be a positive safe integer')
  }
  return {
    maxSearchResults,
    searchTimeoutMs,
    maxResultBytes,
    summaryMaxItems,
    summaryMaxEvidenceCharacters,
  }
}
