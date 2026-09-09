/**
 * `create_session` tool coverage: registration and disposal, the gate ladder
 * (agent, top-level-only, approval presence, approval outcome), target
 * resolution (workspace id vs cwd fallback, preset pass-through and opt-out),
 * the gateway error mapping, and the pure presentation projections.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolSessionStart from '@deepseek-ai/dsh-tool-session-start'

const activeContexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of activeContexts.splice(0)) await ctx.fiber.dispose()
})

interface MountOptions {
  config?: ToolSessionStart.Config
  outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  approval?: boolean
  workspace?: boolean
  callerParent?: SessionIdValue
  preset?: string
}

interface Gateway {
  create: ReturnType<typeof vi.fn>
}

interface Mounted {
  readonly ctx: Context
  readonly fiber: { dispose(): Promise<void> }
  readonly caller: Session
  readonly gateway: Gateway
  readonly approval: ReturnType<typeof vi.fn>
  call(): Promise<ToolExecutionResult>
  callWithoutAgent(): Promise<ToolExecutionResult>
}

async function mount(options: MountOptions = {}): Promise<Mounted> {
  const ctx = new Context()
  activeContexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)

  const approval = vi.fn(async () => options.outcome ?? 'allowed-once')
  if (options.approval !== false) ctx.provide('approval', { request: approval } as never)

  const gateway: Gateway = {
    create: vi.fn(async (request: { rpcId: unknown; payload: Record<string, unknown> }) => ({
      rpcId: request.rpcId,
      // The real gateway echoes the composition the session RUNS.
      result: {
        ok: true as const,
        value: {
          sessionId: SessionId('session-created'),
          ...(request.payload.agentPreset === undefined ? {} : { agentPreset: request.payload.agentPreset }),
        },
      },
    })),
  }
  ctx.provide('apiProxy', { sessions: gateway } as never)

  if (options.workspace !== false) {
    ctx.provide('workspaceRegistry', {
      findBySessionId: vi.fn(() => ({ id: 'ws-1', path: '/work' })),
    } as never)
  }
  if (options.preset !== undefined) {
    ctx.provide('agentPresets', { composedPreset: vi.fn(() => options.preset) } as never)
  }

  const fiber = await ctx.plugin(ToolSessionStart, options.config)
  const caller = ctx.sessions.create(SessionId('caller'), {
    meta: {
      createdAt: 1,
      cwd: '/work',
      ...(options.callerParent === undefined ? {} : { parentSession: options.callerParent }),
    },
  })
  const agent = { id: caller.id, session: caller, ctx } as unknown as Agent
  let calls = 0
  return {
    ctx,
    fiber,
    caller,
    gateway,
    approval,
    call: () => ctx.tools.execute({
      name: 'create_session',
      arguments: {},
      callId: CallId(`call-${++calls}`),
      signal: new AbortController().signal,
      agent,
    }),
    callWithoutAgent: () => ctx.tools.execute({
      name: 'create_session',
      arguments: {},
      callId: CallId('call-anon'),
      signal: new AbortController().signal,
    }),
  }
}

function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

describe('registration', () => {
  it('registers one schema-empty tool and disposes it with the fiber', async () => {
    const mounted = await mount()
    expect(mounted.ctx.tools.schemas().map(schema => schema.name)).toEqual(['create_session'])
    const definition = mounted.ctx.tools.get('create_session')
    expect(definition?.parameters).toEqual({ type: 'object', properties: {} })
    expect(definition?.presentCall?.({})).toEqual({
      card: 'generic',
      kind: 'execute',
      title: 'Start a new chat',
    })
    await mounted.fiber.dispose()
    expect(mounted.ctx.tools.schemas()).toEqual([])
    activeContexts.length = 0
  })

  it('renders the identity fields as relay-ready text', async () => {
    const mounted = await mount()
    const definition = mounted.ctx.tools.get('create_session')
    expect(definition?.output.render({}, {
      sessionId: SessionId('session-created'),
      cwd: '/work',
      agentPreset: 'standard',
      workspaceSource: 'workspace',
    })).toEqual([{
      type: 'text',
      text: 'Started a new chat session-created in /work. It runs the "standard" agent preset. '
        + 'Tell the user it is ready in the sidebar. Do not claim they are viewing it now.',
    }])
    expect(definition?.output.render({}, {
      sessionId: SessionId('session-created'),
      cwd: '/work',
      workspaceSource: 'cwd',
    })).toEqual([{
      type: 'text',
      text: 'Started a new chat session-created in /work. '
        + 'Tell the user it is ready in the sidebar. Do not claim they are viewing it now.',
    }])
  })
})

describe('the gate ladder', () => {
  it('refuses an agent-less call before any approval exists', async () => {
    const mounted = await mount()
    const result = await mounted.callWithoutAgent()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires the calling agent')
    expect(mounted.approval).not.toHaveBeenCalled()
    expect(mounted.gateway.create).not.toHaveBeenCalled()
  })

  it('refuses a subagent caller before any approval exists', async () => {
    const mounted = await mount({ callerParent: SessionId('caller-parent') })
    const result = await mounted.call()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('only a top-level chat can start another chat')
    expect(mounted.approval).not.toHaveBeenCalled()
    expect(mounted.gateway.create).not.toHaveBeenCalled()
  })

  it('refuses without an approval service instead of degrading to silent creation', async () => {
    const mounted = await mount({ approval: false })
    const result = await mounted.call()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no approval service')
    expect(mounted.gateway.create).not.toHaveBeenCalled()
  })

  it('asks the approval seam with the derived target and denies every non-grant', async () => {
    for (const outcome of ['rejected', 'cancelled', 'unavailable'] as const) {
      const mounted = await mount({ outcome })
      const result = await mounted.call()
      expect(mounted.approval).toHaveBeenCalledTimes(1)
      const ask = mounted.approval.mock.calls[0]?.[0] as Record<string, unknown>
      expect(ask).toMatchObject({
        toolName: 'create_session',
        reason: 'Start a new chat in /work. The chat is created empty and appears in the sidebar.',
      })
      expect(ask.agent).toBeDefined()
      expect(ask.callId).toBeDefined()
      expect(ask.signal).toBeInstanceOf(AbortSignal)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain(`did not approve starting a new chat (${outcome})`)
      expect(mounted.gateway.create).not.toHaveBeenCalled()
      await mounted.ctx.fiber.dispose()
      activeContexts.splice(activeContexts.indexOf(mounted.ctx), 1)
    }
  })

  it('refuses a caller without a recorded cwd before asking', async () => {
    const mounted = await mount()
    // `cwd` sits inside the immutable header; a caller from a cwd-less store
    // (session without meta) is the real shape of the refusal.
    const cwdless = mounted.ctx.sessions.create()
    const agent = { id: cwdless.id, session: cwdless, ctx: mounted.ctx } as unknown as Agent
    const result = await mounted.ctx.tools.execute({
      name: 'create_session',
      arguments: {},
      callId: CallId('call-cwdless'),
      signal: new AbortController().signal,
      agent,
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('records no working directory')
    expect(mounted.approval).not.toHaveBeenCalled()
  })
})

describe('creation through the gateway', () => {
  it('creates in the caller workspace with the caller preset after the grant', async () => {
    const mounted = await mount({ preset: 'code' })
    const result = await mounted.call()
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      sessionId: SessionId('session-created'),
      cwd: '/work',
      agentPreset: 'code',
      workspaceSource: 'workspace',
    })
    expect(mounted.gateway.create).toHaveBeenCalledTimes(1)
    const request = mounted.gateway.create.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(request.payload).toEqual({ workspaceId: 'ws-1', agentPreset: 'code' })
  })

  it('falls back to the caller cwd for an ungrouped caller and omits an absent preset', async () => {
    const mounted = await mount({ workspace: false })
    const result = await mounted.call()
    expect(result.value).toEqual({
      sessionId: SessionId('session-created'),
      cwd: '/work',
      workspaceSource: 'cwd',
    })
    const request = mounted.gateway.create.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(request.payload).toEqual({ cwd: '/work' })
  })

  it('composes the deployment default when preset inheritance is switched off', async () => {
    const mounted = await mount({ preset: 'code', config: { inheritPreset: false } })
    await mounted.call()
    const request = mounted.gateway.create.mock.calls[0]?.[0] as { payload: Record<string, unknown> }
    expect(request.payload).toEqual({ workspaceId: 'ws-1' })
  })

  it('maps a gateway business failure to an error result', async () => {
    const mounted = await mount()
    mounted.gateway.create.mockResolvedValueOnce({
      rpcId: 'rpc',
      result: { ok: false as const, error: { code: 'session-conflict' as const, message: 'cwd conflict', details: {} } },
    })
    const result = await mounted.call()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('session creation failed: cwd conflict')
  })
})
