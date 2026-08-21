/**
 * Shell-command source tests on a real cordis Context with fake remote and
 * sessions faces plus real session scopes: the `!` registration, the
 * enter-time decision table (consume + run, bare `!` fall-through, image
 * refusal), the transport-failure notice, and the durable node fold.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createScope, scopeOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientSessionContext, ConsumeTokenRequest } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ShellCommandExecution } from '@deepseek-ai/dsh-shell-command/types'
import type { ShellCommandChatData } from '../src/client/shell-command-node.ts'
import { shellCommandDefinition } from '../src/client/shell-command-node.ts'
import { ShellCommandSource } from '../src/client/source.ts'

const sid = (k: string): SessionId => k as SessionId

const proj = (id: string): ClientSessionContext => ({ sessionId: sid(id) })

/** Deterministic key-echo translator: notice assertions read `ns:key`. */
const t = ((key: string): string => `shellCommand:${key}`) as never

interface BenchOptions {
  /** Scripted admission outcome for the remote run; default resolves success. */
  run?: (payload: { sessionId: SessionId; command: string }) => Promise<ShellCommandExecution>
}

async function bench(opts: BenchOptions = {}) {
  const ctx = new Context()
  const runCalls: Array<{ sessionId: SessionId; command: string }> = []
  const remoteRun = {
    run: async (sessionId: SessionId, command: string, _signal: AbortSignal) => {
      runCalls.push({ sessionId, command })
      try {
        const value = await (opts.run ?? (() => Promise.resolve({
          commandId: 'sh-fake-1' as ShellCommandExecution['commandId'],
          result: { kind: 'success' as const },
        })))({ sessionId, command })
        return { ok: true as const, value }
      } catch (error) {
        return {
          ok: false as const,
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        }
      }
    },
  }
  ctx.provide('remote', { shellCommand: remoteRun })
  ctx.provide('remote.shellCommand', remoteRun)
  // Real scope tags behind a fake sessions face.
  const scopes = new Map<SessionId, { ctx: Context; fiber: { dispose(): Promise<void> } }>()
  ctx.provide('sessions', {
    scope: (id: SessionId) => scopes.get(id)?.ctx,
    scopeOf: (c: Context) => scopeOf(c),
  })
  /** Consume-token bail dispatches collected per scope. */
  const consumes = new Map<SessionId, ConsumeTokenRequest[]>()
  const mint = (key: string) => {
    const handle = createScope(ctx, sid(key))
    scopes.set(sid(key), handle)
    handle.ctx.on('slash/input-consume-token', (request) => {
      const list = consumes.get(sid(key)) ?? []
      list.push(request)
      consumes.set(sid(key), list)
    })
    return handle
  }
  /** Notices the fake conversation face collected (transport-failure routing). */
  const notices: Array<{ scope: SessionId | undefined; level: 'info' | 'error'; text: string }> = []
  ctx.provide('conversation', {
    input: {
      for: (actx: Context) => ({
        notify: (level: 'info' | 'error', text: string) => {
          notices.push({ scope: scopeOf(actx), level, text })
        },
      }),
    },
  })
  const source = new ShellCommandSource(ctx, t)
  return { ctx, source, mint, runCalls, consumes, notices }
}

describe('ShellCommandSource', () => {
  it('declares the adjudication-only `!` trigger and no candidates', async () => {
    const { source } = await bench()
    expect(source.trigger).toBe('!')
    expect(source.name).toBe('shell')
    expect(await source.candidates(proj('s1'), { query: '', position: 'leading', signal: new AbortController().signal })).toEqual([])
    expect((source as { matchSpace?: unknown }).matchSpace).toBeUndefined()
    expect((source as { warm?: unknown }).warm).toBeUndefined()
  })

  it('consumes the line and runs the command on enter', async () => {
    const { source, mint, runCalls, consumes } = await bench()
    mint('s1')
    const signal = new AbortController().signal

    const outcome = await source.matchEnter!(proj('s1'), '!echo hi', signal, { images: 0 })

    expect(outcome).toBe('handled')
    expect(runCalls).toEqual([{ sessionId: sid('s1'), command: 'echo hi' }])
    expect(consumes.get(sid('s1'))).toEqual([{ guard: { kind: 'bare-token', token: '!echo hi' } }])
  })

  it('trims the command and passes the abort signal', async () => {
    const { source, mint, runCalls } = await bench()
    mint('s1')
    const controller = new AbortController()

    const outcome = await source.matchEnter!(proj('s1'), '!  pwd  ', controller.signal, { images: 0 })

    expect(outcome).toBe('handled')
    expect(runCalls).toEqual([{ sessionId: sid('s1'), command: 'pwd' }])
  })

  it('falls through when the line is bare `!` with no command', async () => {
    const { source, mint, runCalls, consumes } = await bench()
    mint('s1')

    const outcome = await source.matchEnter!(proj('s1'), '!', new AbortController().signal, { images: 0 })

    expect(outcome).toBeNull()
    expect(runCalls).toEqual([])
    expect(consumes.size).toBe(0)
  })

  it('refuses lines with attached images and emits a notice', async () => {
    const { source, mint, runCalls, notices } = await bench()
    mint('s1')

    const outcome = await source.matchEnter!(proj('s1'), '!echo hi', new AbortController().signal, { images: 1 })

    expect(outcome).toBe('refused')
    expect(runCalls).toEqual([])
    expect(notices).toEqual([{
      scope: sid('s1'),
      level: 'error',
      text: 'shellCommand:notice.imagesUnsupported',
    }])
  })

  it('routes transport failures to the session notice stream and handles the gesture', async () => {
    const { source, mint, notices } = await bench({
      run: async () => { throw new Error('connection lost') },
    })
    mint('s1')

    await source.matchEnter!(proj('s1'), '!ls', new AbortController().signal, { images: 0 })
    // The detached run settles on a microtask; flush it.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(notices).toEqual([{ scope: sid('s1'), level: 'error', text: 'connection lost' }])
  })
})

describe('shellCommandDefinition', () => {
  it('folds shell/run and shell/done into one chat node', () => {
    const runMatch = {
      event: { type: 'shell/run' as const, seq: 3, time: 100, data: { commandId: 'sh-1', command: 'echo hi', source: { kind: 'user' } } },
    }
    const start = shellCommandDefinition.start(
      { key: 'k', kind: 'shell-command', id: 'ctx-1', matches: [runMatch], start: runMatch, current: new Map() } as never,
      runMatch as never,
      { previous: () => undefined },
    )
    const doneMatch = {
      event: {
        type: 'shell/done' as const,
        seq: 4,
        time: 200,
        data: {
          commandId: 'sh-1',
          kind: 'success',
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: { text: 'hi', truncated: false },
        },
      },
    }
    const updated = shellCommandDefinition.update(
      { key: 'k', kind: 'shell-command', id: 'ctx-1', matches: [runMatch, doneMatch], start: runMatch, current: new Map(), state: start } as never,
      doneMatch as never,
    )
    const node = shellCommandDefinition.buildViewNode!({
      key: 'k',
      kind: 'shell-command',
      id: 'ctx-1',
      matches: [runMatch, doneMatch],
      start: runMatch,
      current: new Map(),
      state: updated,
    } as never)
    expect(node).toMatchObject({
      key: 'k',
      kind: 'shell-command',
      anchorSeq: 3,
      data: {
        seq: 3,
        time: 100,
        commandId: 'sh-1',
        command: 'echo hi',
        outcome: {
          kind: 'success',
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: { text: 'hi', truncated: false },
        },
      },
    })
    const data = node?.data as ShellCommandChatData
    expect(data.outcome).not.toBeNull()
  })

  it('keeps a running shell command with a null outcome', () => {
    const runMatch = {
      event: { type: 'shell/run' as const, seq: 5, time: 50, data: { commandId: 'sh-2', command: 'sleep 1', source: { kind: 'user' } } },
    }
    const start = shellCommandDefinition.start(
      { key: 'k', kind: 'shell-command', id: 'ctx-2', matches: [runMatch], start: runMatch, current: new Map() } as never,
      runMatch as never,
      { previous: () => undefined },
    )
    expect(start.outcome).toBeNull()
  })
})
