import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import type { JobHooks, JobOutcome, JobStart } from '@deepseek-ai/dsh-jobs'
import type { SelfUpdateService } from '@deepseek-ai/dsh-host-self-update'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import * as ToolRebuild from '@deepseek-ai/dsh-tool-rebuild'

type UpdateHandoff = ReturnType<SelfUpdateService['createWebUpdateHandoff']>

const TEST_CONFIG = { jobStopTimeoutMs: 10_000 } satisfies ToolRebuild.Config

function fakeSelfUpdate(overrides: Partial<Pick<SelfUpdateService, 'quiesceAgents' | 'createWebUpdateHandoff'>> = {}) {
  const handoff: UpdateHandoff = { command: 'node', args: ['runner.js', 'plan'], cwd: '/repo' }
  const quiesceAgents = overrides.quiesceAgents ?? vi.fn(async () => ({ cancelled: 0, drained: true }))
  const createWebUpdateHandoff = overrides.createWebUpdateHandoff ?? vi.fn(() => handoff)
  return {
    service: { quiesceAgents, createWebUpdateHandoff } as unknown as SelfUpdateService,
    quiesceAgents: quiesceAgents as ReturnType<typeof vi.fn>,
    createWebUpdateHandoff: createWebUpdateHandoff as ReturnType<typeof vi.fn>,
    handoff,
  }
}

function fakeLifecycle() {
  return { exit: vi.fn(), restart: vi.fn() }
}

interface Harness {
  ctx: Context
  lifecycle: ReturnType<typeof fakeLifecycle>
  selfUpdate: ReturnType<typeof fakeSelfUpdate>
  rebuildFiber: { dispose: () => Promise<void> }
}

async function setup(options: { jobs?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (options.jobs !== false) await ctx.plugin(LocalJobRegistry)
  const lifecycle = fakeLifecycle()
  ctx.provide('appLifecycle', lifecycle)
  const selfUpdate = fakeSelfUpdate()
  ctx.provide('selfUpdate', selfUpdate.service)
  ctx.provide('webServer', { host: '127.0.0.1', port: 3080 } as unknown as WebServer)
  if (options.jobs !== false) ctx.jobs.attachController('tool-rebuild-test')
  const rebuildFiber = await ctx.plugin(ToolRebuild, TEST_CONFIG)
  return { ctx, lifecycle, selfUpdate, rebuildFiber }
}

/** A fake registered agent whose `whenIdle` resolves only on demand (or rejects with `rejectIdle`). */
function fakeAgent(ctx: Context, options: { rejectIdle?: boolean } = {}): { agent: Agent; goIdle: () => void } {
  const scopeFiber = ctx.plugin(() => {})
  let release!: () => void
  const gate = new Promise<void>((resolve, reject) => {
    release = options.rejectIdle === true ? () => { reject(new Error('idle rejected')) } : resolve
  })
  const id = SessionId('rebuild-session')
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    inject: () => {},
    status: 'running',
    session: { id, header: { version: 0, id, createdAt: 0 } },
    whenIdle: () => gate,
  } as unknown as Agent
  ctx.agents.register(agent)
  return { agent, goIdle: release }
}

/** A controllable producer start-spec (settle `done` on demand, record cancels). */
function producer(overrides: Partial<Omit<JobStart, 'run'> & JobHooks> = {}) {
  let settle!: (outcome: JobOutcome) => void
  const cancels: (string | undefined)[] = []
  const { kind = 'bash', label = 'sleep 60', owner, outputLimitBytes, ...hookOverrides } = overrides
  const hooks: JobHooks = {
    cancel(reason) { cancels.push(reason) },
    done: new Promise<JobOutcome>((res) => { settle = res }),
    ...hookOverrides,
  }
  const spec: JobStart = {
    kind,
    label,
    ...owner !== undefined ? { owner } : {},
    ...outputLimitBytes !== undefined ? { outputLimitBytes } : {},
    run: () => hooks,
  }
  return { spec, settle, cancels }
}

let callCounter = 0
function call(ctx: Context, agent: Agent, signal = new AbortController().signal) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`call-${++callCounter}`),
    name: 'rebuild_harness',
    arguments: {},
    agent,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const tick = () => new Promise<void>(r => setTimeout(r, 0))

describe('rebuild_harness capabilities', () => {
  it('refuses a direct registry call with no calling agent', async () => {
    const { ctx } = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('call-no-agent'),
      name: 'rebuild_harness',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires the calling agent')
  })

  it('refuses when the launcher cannot replace its own process', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('selfUpdate', fakeSelfUpdate().service)
    ctx.provide('webServer', { host: '127.0.0.1', port: 3080 } as unknown as WebServer)
    await ctx.plugin(ToolRebuild, TEST_CONFIG)
    const { agent } = fakeAgent(ctx)
    const result = await call(ctx, agent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('cannot replace its own process')
  })

  it('refuses when no self-update provider composes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('appLifecycle', fakeLifecycle())
    await ctx.plugin(ToolRebuild, TEST_CONFIG)
    const { agent } = fakeAgent(ctx)
    const result = await call(ctx, agent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no self-update provider')
  })

  it('refuses when no webServer service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    ctx.provide('appLifecycle', fakeLifecycle())
    ctx.provide('selfUpdate', fakeSelfUpdate().service)
    await ctx.plugin(ToolRebuild, TEST_CONFIG)
    const { agent } = fakeAgent(ctx)
    const result = await call(ctx, agent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no webServer service')
  })
})

describe('rebuild_harness execution', () => {
  it('stops owned running jobs, records their settlement, and restarts after idle', async () => {
    const { ctx, lifecycle, selfUpdate } = await setup()
    const { agent, goIdle } = fakeAgent(ctx)
    const job = producer({ owner: agent })
    ctx.jobs.start(job.spec)

    const pending = call(ctx, agent)
    await vi.waitFor(() => { expect(job.cancels).toEqual(['harness rebuild']) })
    job.settle({ status: 'killed' })
    const result = await pending
    expect(result.isError).toBe(false)
    await tick()
    const output = text(result)
    expect(output).toContain('bash-1 [bash] sleep 60 -> killed')
    expect(output).toContain('restart the stopped jobs listed above')

    goIdle()
    await vi.waitFor(() => { expect(lifecycle.restart).toHaveBeenCalledTimes(1) })
    expect(selfUpdate.quiesceAgents).toHaveBeenCalledTimes(1)
    expect(selfUpdate.createWebUpdateHandoff).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 3080 },
      { pull: false },
    )
    expect(lifecycle.restart).toHaveBeenCalledWith(selfUpdate.handoff)
  })

  it('treats a second call while a rebuild is pending as already scheduled', async () => {
    const { ctx, lifecycle } = await setup()
    const { agent } = fakeAgent(ctx)
    const first = await call(ctx, agent)
    expect(first.isError).toBe(false)
    const second = await call(ctx, agent)
    expect(second.isError).toBe(false)
    expect(text(second)).toContain('already scheduled')
    expect(text(second)).toContain('No running background jobs')
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('leaves settled jobs alone and reports that nothing was running', async () => {
    const { ctx, lifecycle } = await setup()
    const { agent } = fakeAgent(ctx)
    const job = producer({ owner: agent })
    ctx.jobs.start(job.spec)
    job.settle({ status: 'completed' })
    await tick()

    const result = await call(ctx, agent)
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('No running background jobs of yours needed stopping.')
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('disarming through plugin disposal cancels the pending restart', async () => {
    const { ctx, lifecycle, rebuildFiber } = await setup()
    const { agent, goIdle } = fakeAgent(ctx)
    await call(ctx, agent)

    await rebuildFiber.dispose()
    goIdle()
    await tick()
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('contains a quiescence failure without restarting', async () => {
    const { ctx, lifecycle, selfUpdate } = await setup()
    selfUpdate.quiesceAgents.mockRejectedValueOnce(new Error('drain failed'))
    const { agent, goIdle } = fakeAgent(ctx)
    await call(ctx, agent)

    goIdle()
    await vi.waitFor(() => { expect(selfUpdate.quiesceAgents).toHaveBeenCalledTimes(1) })
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('contains a non-Error quiescence failure without restarting', async () => {
    const { ctx, lifecycle, selfUpdate } = await setup()
    selfUpdate.quiesceAgents.mockRejectedValueOnce('drain failed')
    const { agent, goIdle } = fakeAgent(ctx)
    await call(ctx, agent)

    goIdle()
    await vi.waitFor(() => { expect(selfUpdate.quiesceAgents).toHaveBeenCalledTimes(1) })
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('skips the handoff when the restart capability disappears before idle', async () => {
    const { ctx, lifecycle, selfUpdate } = await setup()
    const { agent, goIdle } = fakeAgent(ctx)
    await call(ctx, agent)
    delete (lifecycle as { restart?: unknown }).restart

    goIdle()
    await vi.waitFor(() => { expect(selfUpdate.quiesceAgents).toHaveBeenCalledTimes(1) })
    await new Promise(r => setTimeout(r, 20))
    expect(selfUpdate.createWebUpdateHandoff).not.toHaveBeenCalled()
  })

  it('skips the handoff when the plugin is disposed while quiescence is in flight', async () => {
    const { ctx, lifecycle, selfUpdate, rebuildFiber } = await setup()
    let releaseQuiesce!: () => void
    selfUpdate.quiesceAgents.mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseQuiesce = resolve }),
    )
    const { agent, goIdle } = fakeAgent(ctx)
    await call(ctx, agent)

    goIdle()
    await vi.waitFor(() => { expect(selfUpdate.quiesceAgents).toHaveBeenCalledTimes(1) })
    await rebuildFiber.dispose()
    releaseQuiesce()
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('contains a whenIdle rejection without restarting', async () => {
    const { ctx, lifecycle } = await setup()
    const { agent, goIdle } = fakeAgent(ctx, { rejectIdle: true })
    await call(ctx, agent)

    goIdle()
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('schedules nothing when the caller aborts during the job waits', async () => {
    const { ctx, lifecycle } = await setup()
    const { agent, goIdle } = fakeAgent(ctx)
    const job = producer({ owner: agent })
    ctx.jobs.start(job.spec)

    const controller = new AbortController()
    const pending = call(ctx, agent, controller.signal)
    await vi.waitFor(() => { expect(job.cancels).toEqual(['harness rebuild']) })
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('aborted')

    goIdle()
    await new Promise(r => setTimeout(r, 20))
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('serves a deployment without a jobs registry with an empty record', async () => {
    const { ctx, lifecycle } = await setup({ jobs: false })
    const { agent } = fakeAgent(ctx)
    const result = await call(ctx, agent)
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('No running background jobs')
    expect(text(result)).toContain('The web host exits after this turn ends')
    expect(lifecycle.restart).not.toHaveBeenCalled()
  })

  it('renders its pending card as a generic execute call and never joins parallel groups', async () => {
    const { ctx } = await setup()
    const definition = ctx.tools.get('rebuild_harness')
    expect(definition).toBeDefined()
    expect(definition?.presentCall?.({})).toEqual({
      card: 'generic',
      title: 'Rebuild harness and restart the web host',
      kind: 'execute',
    })
    expect(definition?.isConcurrencySafe?.({})).toBe(false)
  })
})
