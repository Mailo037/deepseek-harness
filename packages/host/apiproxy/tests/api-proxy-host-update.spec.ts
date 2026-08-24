import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent'
import { GitError } from '@deepseek-ai/dsh-host-self-update'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { HostRepository, UpdateCheck } from '@deepseek-ai/dsh-host-apiproxy/api/host'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`host-update-${String(nextRpc++)}`), payload }
}

function expectValue<T>(response: RpcResponse<T>): T {
  if (!response.result.ok) throw new Error(`expected successful response: ${JSON.stringify(response.result)}`)
  return response.result.value
}

/** The identity the stub selfUpdate service reports. */
const IDENTITY = {
  branch: 'master',
  commit: 'a'.repeat(40),
  remoteUrl: 'https://example.com/repo.git',
}

type SelfUpdateStub = {
  describe: ReturnType<typeof vi.fn>
  check: ReturnType<typeof vi.fn>
  quiesceAgents: ReturnType<typeof vi.fn>
  pull: ReturnType<typeof vi.fn>
  createWebUpdateHandoff: ReturnType<typeof vi.fn>
}

/** A structural selfUpdate stub; the gateway reads the service with ctx.get. */
function selfUpdateStub(overrides?: Partial<SelfUpdateStub>): SelfUpdateStub {
  const check: UpdateCheck = {
    available: true,
    branch: 'master',
    commit: 'a'.repeat(40),
    upstream: 'origin/master',
    behind: 2,
    latest: { commit: 'b'.repeat(40), subject: 'feat: newer' },
    checkedAt: 1,
  }
  return {
    describe: vi.fn(() => Promise.resolve(IDENTITY)),
    check: vi.fn(() => Promise.resolve(check)),
    quiesceAgents: vi.fn(() => Promise.resolve({ cancelled: 0, drained: true })),
    pull: vi.fn(() => Promise.resolve({ advanced: true, previousCommit: 'a'.repeat(40), commit: 'b'.repeat(40) })),
    createWebUpdateHandoff: vi.fn(() => ({ command: 'node', args: ['runner'], cwd: '/tmp' })),
    ...overrides,
  }
}

async function harness(stub: SelfUpdateStub | undefined, restart?: ReturnType<typeof vi.fn>): Promise<{
  ctx: Context
  api: ReturnType<typeof createApiProxy>
}> {
  const ctx = new Context()
  // createApiProxy registers its ask-user provider at construction time.
  await ctx.plugin(UserQuestionService)
  ctx.provide('agents', { list: () => [] })
  if (stub !== undefined) ctx.provide('selfUpdate', stub)
  ctx.provide('appLifecycle', restart === undefined ? { exit: () => {} } : { exit: () => {}, restart })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
  })
  return { ctx, api }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('host domain update plane', () => {
  it('describes repository identity and restart capability when composed', async () => {
    const stub = selfUpdateStub()
    const restart = vi.fn()
    const { ctx, api } = await harness(stub, restart)
    const value = expectValue(await api.host.describe(request({})))
    expect(value.version).not.toBe('')
    expect(value.repository).toEqual(IDENTITY satisfies HostRepository)
    expect(value.canRestart).toBe(true)
    expect(value.surface).toBe('web')
    await ctx.fiber.dispose()
  })

  it('degrades to a null repository and no restart without the capabilities', async () => {
    const { ctx, api } = await harness(undefined)
    const value = expectValue(await api.host.describe(request({})))
    expect(value.repository).toBeNull()
    expect(value.canRestart).toBe(false)
    await ctx.fiber.dispose()
  })

  it('passes a check through and forwards the force flag', async () => {
    const stub = selfUpdateStub()
    const { ctx, api } = await harness(stub, vi.fn())
    const value = expectValue(await api.host.checkUpdate(request({ force: true })))
    expect(value.available).toBe(true)
    expect(stub.check).toHaveBeenCalledWith({ force: true })
    await ctx.fiber.dispose()
  })

  it('maps the closed git failure vocabulary onto wire codes', async () => {
    for (const [code, wire] of [
      ['no-upstream', 'self-update-no-upstream'],
      ['not-fast-forward', 'self-update-not-fast-forward'],
      ['git-failed', 'self-update-git-failed'],
      ['not-a-repository', 'self-update-unavailable'],
    ] as const) {
      const stub = selfUpdateStub({ check: vi.fn(() => Promise.reject(new GitError(code, 'tool said no'))) })
      const { ctx, api } = await harness(stub, vi.fn())
      expect((await api.host.checkUpdate(request({}))).result).toMatchObject({
        ok: false,
        error: { code: wire },
      })
      await ctx.fiber.dispose()
    }
  })

  it('answers self-update-unavailable without a composed provider', async () => {
    const { ctx, api } = await harness(undefined, vi.fn())
    expect((await api.host.checkUpdate(request({}))).result).toMatchObject({
      ok: false,
      error: { code: 'self-update-unavailable' },
    })
    expect((await api.host.applyUpdate(request({}))).result).toMatchObject({
      ok: false,
      error: { code: 'self-update-unavailable' },
    })
    await ctx.fiber.dispose()
  })

  it('refuses apply on a launcher that cannot respawn', async () => {
    const { ctx, api } = await harness(selfUpdateStub())
    expect((await api.host.applyUpdate(request({}))).result).toMatchObject({
      ok: false,
      error: { code: 'restart-unavailable' },
    })
    await ctx.fiber.dispose()
  })

  it('quiesces agents before pulling and schedules one native respawn after the response', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const stub = selfUpdateStub({
      quiesceAgents: vi.fn(async () => {
        order.push('quiesce')
        return { cancelled: 1, drained: true }
      }),
      pull: vi.fn(async () => {
        order.push('pull')
        return { advanced: true, previousCommit: 'a'.repeat(40), commit: 'b'.repeat(40) }
      }),
    })
    const restart = vi.fn(() => { order.push('restart') })
    const { ctx, api } = await harness(stub, restart)
    const pending = api.host.applyUpdate(request({}))
    const value = expectValue(await pending)
    // The response lands before any process replacement is scheduled.
    expect(order).toEqual(['quiesce', 'pull'])
    expect(value).toEqual({ started: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(restart).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['quiesce', 'pull', 'restart'])
    await ctx.fiber.dispose()
  })

  it('hands a Web update to a detached runner without pulling in the host process', async () => {
    vi.useFakeTimers()
    const handoff = { command: 'node', args: ['runner'], cwd: '/tmp' }
    const stub = selfUpdateStub({ createWebUpdateHandoff: vi.fn(() => handoff) })
    const restart = vi.fn()
    const { ctx, api } = await harness(stub, restart)
    ctx.provide('webServer', { host: '127.0.0.1', port: 4567 })

    expectValue(await api.host.applyUpdate(request({})))
    expect(stub.createWebUpdateHandoff).toHaveBeenCalledWith({ host: '127.0.0.1', port: 4567 })
    expect(stub.pull).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(restart).toHaveBeenCalledWith(handoff)
    await ctx.fiber.dispose()
  })

  it('keeps the process alive when the pull refuses to fast-forward', async () => {
    vi.useFakeTimers()
    const stub = selfUpdateStub({
      pull: vi.fn(() => Promise.reject(new GitError('not-fast-forward', 'diverged'))),
    })
    const restart = vi.fn()
    const { ctx, api } = await harness(stub, restart)
    expect((await api.host.applyUpdate(request({}))).result).toMatchObject({
      ok: false,
      error: { code: 'self-update-not-fast-forward' },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(restart).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
