import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent'
import { GitError, SelfUpdateService, detectRepositoryRoot,
  type GitCommandRunner } from '../src/index.ts'

/** One reply or a sequence of replies per bare argv (joined, no -C prefix). */
type Reply = string | readonly string[]

/**
 * Scripted runner over one working tree: argv arrive with the `-C <root>`
 * prefix the service owns, so the table keys are the bare git argv. A plain
 * string answers every time; an array is consumed once per call (rev-parse
 * HEAD before/after a merge). A missing or exhausted script fails loudly.
 */
function scriptedFor(root: string, replies: Map<string, Reply>): GitCommandRunner {
  const queues = new Map<string, string[]>()
  for (const [key, value] of replies) {
    if (typeof value !== 'string') queues.set(key, [...value])
  }
  return async (args) => {
    if (args[0] !== '-C' || args[1] !== root) {
      throw new GitError('git-failed', `scripted git: unexpected invocation "${args.join(' ')}"`)
    }
    const key = args.slice(2).join(' ')
    const value = replies.get(key)
    if (typeof value === 'string') return value
    const reply = queues.get(key)?.shift()
    if (reply === undefined) throw new GitError('git-failed', `scripted git: unexpected or exhausted argv "${key}"`)
    return reply
  }
}

/** A live-agent stub carrying just the quiescence surface the service drives. */
function fakeAgent(): { agent: unknown; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn()
  return { agent: { id: 'agent', status: 'running', cancel, whenIdle: () => Promise.resolve() }, cancel }
}

/** One service over the shared scripted tree; the agents registry is a stub. */
function serviceOf(
  root: string,
  replies: Map<string, Reply>,
  agents: unknown[] = [],
  overrides?: { root?: string },
): SelfUpdateService {
  const ctx = new Context()
  ctx.provide('agents', { list: () => agents })
  return new SelfUpdateService(ctx, {
    root: overrides?.root ?? root,
    commandTimeoutMs: 1_000,
    fetchTimeoutMs: 2_000,
    checkCacheMs: 60_000,
  }, scriptedFor(root, replies))
}

/** The identity script every describe-shaped test reads. */
function identityReplies(): Map<string, Reply> {
  return new Map(<[string, Reply][]>[
    ['rev-parse --abbrev-ref HEAD', 'master\n'],
    ['rev-parse HEAD', 'a'.repeat(40)],
    ['remote get-url origin', 'https://example.com/repo.git\n'],
  ])
}

describe('SelfUpdateService', () => {
  // One real directory carrying a .git entry: status() checks existence, so
  // the capability answers truthfully without any git subprocess.
  const repo = mkdtempSync(join(tmpdir(), 'dsh-self-update-'))
  mkdirSync(join(repo, '.git'))

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('reports the unavailable capability without a working tree and describes null', async () => {
    const missing = process.platform === 'win32'
      ? join(tmpdir(), 'dsh-self-update-missing')
      : '/no-such-checkout'
    const service = serviceOf(repo, identityReplies(), [], { root: missing })
    expect(service.status()).toEqual({
      kind: 'unavailable',
      reason: 'no git working tree found above the dsh installation',
    })
    await expect(service.describe()).resolves.toBeNull()
  })

  it('reads identity once per cache window', async () => {
    const runner = vi.fn(scriptedFor(repo, identityReplies()))
    const ctx = new Context()
    ctx.provide('agents', { list: () => [] })
    const service = new SelfUpdateService(ctx, {
      root: repo, commandTimeoutMs: 1_000, fetchTimeoutMs: 2_000, checkCacheMs: 60_000,
    }, runner)
    const first = await service.describe()
    const second = await service.describe()
    expect(first).toEqual(second)
    expect(first).toMatchObject({ branch: 'master', remoteUrl: 'https://example.com/repo.git' })
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('caches a check until forced and reads branch/commit before the fetch', async () => {
    const replies = new Map(<[string, Reply][]>[
      ['rev-parse --abbrev-ref HEAD', 'master\n'],
      ['rev-parse HEAD', 'a'.repeat(40)],
      ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['fetch', ''],
      ['rev-list --count HEAD..origin/master', '2\n'],
      ['log -1 --format=%H%x00%s origin/master', `b${'0'.repeat(39)}\u0000feat: newer\n`],
    ])
    const runner = vi.fn(scriptedFor(repo, replies))
    const ctx = new Context()
    ctx.provide('agents', { list: () => [] })
    const service = new SelfUpdateService(ctx, {
      root: repo, commandTimeoutMs: 1_000, fetchTimeoutMs: 2_000, checkCacheMs: 60_000,
    }, runner)
    const first = await service.check()
    expect(first).toMatchObject({
      available: true, behind: 2, upstream: 'origin/master',
      latest: { subject: 'feat: newer' },
    })
    const callsAfterFirst = runner.mock.calls.length
    await expect(service.check()).resolves.toBe(first)
    expect(runner.mock.calls.length).toBe(callsAfterFirst)
    await expect(service.check({ force: true })).resolves.not.toBe(first)
    expect(runner.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('checks a github.com remote with one compare request and no git fetch', async () => {
    const replies = new Map(<[string, Reply][]>[
      ['rev-parse --abbrev-ref HEAD', 'master\n'],
      ['rev-parse HEAD', 'a'.repeat(40)],
      ['remote get-url origin', 'https://github.com/Mailo037/deepseek-harness.git\n'],
    ])
    const payload = {
      ok: true,
      json: async () => ({
        behind_by: 3,
        commits: [{ sha: 'c'.repeat(40), commit: { message: 'feat: tip\n\nbody' } }],
      }),
    }
    const ctx = new Context()
    ctx.provide('agents', { list: () => [] })
    const service = new SelfUpdateService(ctx, {
      root: repo, commandTimeoutMs: 1_000, fetchTimeoutMs: 2_000, checkCacheMs: 60_000,
    }, scriptedFor(repo, replies), async () => payload as unknown as Response)
    // scriptedFor fails loudly on any unexpected argv, so a resolution here
    // also proves no `-C <repo> fetch` was ever requested.
    await expect(service.check()).resolves.toMatchObject({
      available: true,
      behind: 3,
      upstream: 'Mailo037/deepseek-harness/branches/master',
      latest: { commit: 'c'.repeat(40), subject: 'feat: tip' },
    })
  })

  it('falls back to git fetch when the GitHub compare request fails (e.g. 404)', async () => {
    const replies = new Map(<[string, Reply][]>[
      ['rev-parse --abbrev-ref HEAD', 'master\n'],
      ['rev-parse HEAD', 'a'.repeat(40)],
      ['remote get-url origin', 'https://github.com/Mailo037/deepseek-harness.git\n'],
      ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['fetch', ''],
      ['rev-list --count HEAD..origin/master', '1\n'],
      ['log -1 --format=%H%x00%s origin/master', `d${'0'.repeat(39)}\u0000feat: from-git-fetch\n`],
    ])
    const payload = {
      ok: false,
      status: 404,
    }
    const ctx = new Context()
    ctx.provide('agents', { list: () => [] })
    const service = new SelfUpdateService(ctx, {
      root: repo, commandTimeoutMs: 1_000, fetchTimeoutMs: 2_000, checkCacheMs: 60_000,
    }, scriptedFor(repo, replies), async () => payload as unknown as Response)
    await expect(service.check()).resolves.toMatchObject({
      available: true,
      behind: 1,
      upstream: 'origin/master',
      latest: { commit: `d${'0'.repeat(39)}`, subject: 'feat: from-git-fetch' },
    })
  })

  it('quiesces every live agent with kept inbox work and waits for idle', async () => {
    const first = fakeAgent()
    const second = fakeAgent()
    const service = serviceOf(repo, identityReplies(), [first.agent, second.agent])
    await expect(service.quiesceAgents()).resolves.toEqual({ cancelled: 2, drained: true })
    expect(first.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(second.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  })

  it('pulls fast-forward through the serialized chain and reports advancement', async () => {
    const replies = new Map(<[string, Reply][]>[
      ['rev-parse HEAD', ['old', 'new']],
      ['rev-parse --abbrev-ref --symbolic-full-name @{upstream}', 'origin/master\n'],
      ['fetch', ''],
      ['merge --ff-only origin/master', ''],
    ])
    const service = serviceOf(repo, replies)
    await expect(service.pull()).resolves.toEqual({
      advanced: true, previousCommit: 'old', commit: 'new',
    })
  })

  it('detects no repository root above a non-checkout path', () => {
    const outside = process.platform === 'win32'
      ? join(tmpdir(), 'dsh-self-update-detect-none')
      : '/definitely/not/a/checkout/here'
    expect(detectRepositoryRoot(outside)).toBeNull()
    // And the source layout's own package directory finds this repository.
    expect(detectRepositoryRoot(join(import.meta.dirname, '..', '..'))).not.toBeNull()
  })
})
