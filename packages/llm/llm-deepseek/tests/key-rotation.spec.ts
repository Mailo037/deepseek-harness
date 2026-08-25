/**
 * llm-deepseek key rotation: the plugin's `agent/request-error` recovery
 * listener retires a quota-failed key and asks the loop to retry with a
 * backup, and the per-request resolver honors the retirement on the next
 * call. The adapter's error annotation (`apiKeyRef`) is what tells the
 * listener which key to retire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const PROVIDER = 'deepseek-official'

let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-llm-deepseek-rotation-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

async function harness(config: object = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmDeepSeek, { baseURL: 'http://127.0.0.1:1', ...config })
  return ctx
}

/** The recovery payload the agent loop dispatches after a failed step. */
function recoveryPayload(failure: LlmFailure, provider = PROVIDER): {
  agent: never
  turn: number
  step: number
  provider: string
  failure: LlmFailure
  retryPolicy: undefined
  signal: AbortSignal
} {
  return {
    agent: {} as never,
    turn: 1,
    step: 1,
    provider,
    failure,
    retryPolicy: undefined,
    signal: new AbortController().signal,
  }
}

function quota(apiKeyRef: string): LlmFailure {
  return { message: 'usage limit reached', code: QUOTA_EXCEEDED_CODE, apiKeyRef }
}

describe('llm-deepseek key rotation recovery', () => {
  it('retires a quota-failed key and asks the loop to retry while a backup remains', async () => {
    const ctx = await harness({ backupApiKeys: ['BACKUP_KEY'] })
    const next = vi.fn(async () => undefined)
    const action = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('DEEPSEEK_API_KEY')),
      next,
    )
    expect(action).toEqual({ kind: 'retry' })
    expect(next).not.toHaveBeenCalled()
  })

  it('stays terminal once every configured key is exhausted', async () => {
    const ctx = await harness({ backupApiKeys: ['BACKUP_KEY'] })
    const first = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('DEEPSEEK_API_KEY')),
      vi.fn(async () => undefined),
    )
    expect(first).toEqual({ kind: 'retry' })
    const second = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('BACKUP_KEY')),
      vi.fn(async () => undefined),
    )
    expect(second).toBeUndefined()
  })

  it('delegates failures of other providers, non-quota codes, and unknown refs', async () => {
    const ctx = await harness({ backupApiKeys: ['BACKUP_KEY'] })
    const delegated = [
      recoveryPayload(quota('DEEPSEEK_API_KEY'), 'some-other-provider'),
      recoveryPayload({ message: 'slow down', code: 'RATE_LIMIT', apiKeyRef: 'DEEPSEEK_API_KEY' }),
      recoveryPayload(quota('FOREIGN_KEY')),
      recoveryPayload({ message: 'usage limit reached', code: QUOTA_EXCEEDED_CODE }),
    ]
    for (const payload of delegated) {
      const next = vi.fn(async () => undefined)
      await expect(ctx.waterfall('agent/request-error', payload, next)).resolves.toBeUndefined()
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('does not rotate a single-key provider', async () => {
    const ctx = await harness()
    const next = vi.fn(async () => undefined)
    await expect(ctx.waterfall('agent/request-error', recoveryPayload(quota('DEEPSEEK_API_KEY')), next))
      .resolves.toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('llm-deepseek key rotation resolution', () => {
  it('serves the backup key on the next request after a quota failure retires the primary', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'primary-key')
    vi.stubEnv('BACKUP_KEY', 'backup-key')
    const server = await mockServer([
      {
        kind: 'http-error',
        status: 402,
        body: JSON.stringify({ error: { message: 'usage limit reached' } }),
      },
      { kind: 'sse', events: textEvents },
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { baseURL: server.url, backupApiKeys: ['BACKUP_KEY'] })

    const failed = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(failed.finish).toEqual({
      kind: 'error',
      failure: {
        message: 'usage limit reached',
        code: QUOTA_EXCEEDED_CODE,
        status: 402,
        apiKeyRef: 'DEEPSEEK_API_KEY',
      },
    })
    expect(server.headers[0]?.authorization).toBe('Bearer primary-key')

    // The loop's recovery decision after the failed attempt (the same dispatch
    // the agent-loop runs) retires the primary key.
    const action = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('DEEPSEEK_API_KEY')),
      vi.fn(async () => undefined),
    )
    expect(action).toEqual({ kind: 'retry' })

    const succeeded = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(succeeded.finish).toEqual({ kind: 'stop' })
    expect(server.headers[1]?.authorization).toBe('Bearer backup-key')
  })

  it('resolves a quota failure to a terminal error once every key is exhausted', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'primary-key')
    vi.stubEnv('BACKUP_KEY', 'backup-key')
    const server = await mockServer([
      { kind: 'http-error', status: 402, body: JSON.stringify({ error: { message: 'usage limit reached' } }) },
      { kind: 'http-error', status: 402, body: JSON.stringify({ error: { message: 'usage limit reached' } }) },
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmDeepSeek, { baseURL: server.url, backupApiKeys: ['BACKUP_KEY'] })

    const failed = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(failed.finish.kind).toBe('error')
    await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('DEEPSEEK_API_KEY')),
      vi.fn(async () => undefined),
    )
    const second = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.finish.kind).toBe('error')
    await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('BACKUP_KEY')),
      vi.fn(async () => undefined),
    )
    // Every key is retired; a further recovery decision must stay terminal.
    const terminal = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('BACKUP_KEY')),
      vi.fn(async () => undefined),
    )
    expect(terminal).toBeUndefined()
  })
})
