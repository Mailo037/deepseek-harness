/**
 * llm-pi-ai key rotation: the plugin's `agent/request-error` recovery
 * listener retires a quota-failed key and asks the loop to retry with a
 * backup, and the per-request resolver honors the retirement on the next
 * call. The adapter's finish-chunk annotation (`apiKeyRef`) is what tells the
 * listener which key to retire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

beforeEach(() => {
  vi.stubEnv('PI_TEST_KEY', 'primary-key')
  vi.stubEnv('BACKUP_KEY', 'backup-key')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

async function harness(baseURL: string, profile: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL, ...profile } },
  })
  return ctx
}

/** The recovery payload the agent loop dispatches after a failed step. */
function recoveryPayload(failure: LlmFailure, provider = 'deepseek'): {
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

describe('llm-pi-ai key rotation recovery', () => {
  it('retires a quota-failed key and asks the loop to retry while a backup remains', async () => {
    const ctx = await harness('http://127.0.0.1:1', { backupApiKeys: ['BACKUP_KEY'] })
    const next = vi.fn(async () => undefined)
    const action = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('PI_TEST_KEY')),
      next,
    )
    expect(action).toEqual({ kind: 'retry' })
    expect(next).not.toHaveBeenCalled()
  })

  it('stays terminal once every configured key is exhausted', async () => {
    const ctx = await harness('http://127.0.0.1:1', { backupApiKeys: ['BACKUP_KEY'] })
    const first = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('PI_TEST_KEY')),
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
    const ctx = await harness('http://127.0.0.1:1', { backupApiKeys: ['BACKUP_KEY'] })
    const delegated = [
      recoveryPayload(quota('PI_TEST_KEY'), 'other-route'),
      recoveryPayload({ message: 'slow down', code: 'RATE_LIMIT', apiKeyRef: 'PI_TEST_KEY' }),
      recoveryPayload(quota('FOREIGN_KEY')),
      recoveryPayload({ message: 'usage limit reached', code: QUOTA_EXCEEDED_CODE }),
    ]
    for (const payload of delegated) {
      const next = vi.fn(async () => undefined)
      await expect(ctx.waterfall('agent/request-error', payload, next)).resolves.toBeUndefined()
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('does not rotate a route without backup keys or without a credential reference', async () => {
    const ctx = await harness('http://127.0.0.1:1')
    const next = vi.fn(async () => undefined)
    await expect(ctx.waterfall('agent/request-error', recoveryPayload(quota('PI_TEST_KEY')), next))
      .resolves.toBeUndefined()
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('llm-pi-ai key rotation resolution', () => {
  it('serves the backup key on the next request after a quota failure retires the primary', async () => {
    const server = await mockServer([
      {
        status: 429,
        body: JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }),
      },
      { events: textEvents },
    ])
    const ctx = await harness(server.url, { backupApiKeys: ['BACKUP_KEY'] })

    const failed = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(failed.finish.kind).toBe('error')
    expect(failed.finish).toMatchObject({
      kind: 'error',
      failure: { code: QUOTA_EXCEEDED_CODE, apiKeyRef: 'PI_TEST_KEY' },
    })
    expect(server.headers[0]?.authorization).toBe('Bearer primary-key')

    // The loop's recovery decision after the failed attempt (the same dispatch
    // the agent-loop runs) retires the primary key.
    const action = await ctx.waterfall(
      'agent/request-error',
      recoveryPayload(quota('PI_TEST_KEY')),
      vi.fn(async () => undefined),
    )
    expect(action).toEqual({ kind: 'retry' })

    const succeeded = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(succeeded.finish).toEqual({ kind: 'stop' })
    expect(server.headers[1]?.authorization).toBe('Bearer backup-key')
  })
})
