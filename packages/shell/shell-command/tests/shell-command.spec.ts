import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { JobStart } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs'
import ShellCommandService from '@deepseek-ai/dsh-shell-command'
import type { Config } from '@deepseek-ai/dsh-shell-command'

const SESSION_CWD = resolve('work')

/** Deterministic executor stub: records the resolved spec and returns a canned run result. */
class StubExecutor extends ShellExecutor {
  readonly specs: ShellExecSpec[] = []

  constructor(
    ctx: Context,
    private readonly outcome: (spec: ShellExecSpec) => ShellRunResult,
  ) {
    super(ctx)
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    const spec: ShellExecSpec = {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: 1_000,
      stdoutMaxBytes: 1_024,
      sandboxPolicy: request.sandboxPolicy,
    }
    this.specs.push(spec)
    return spec
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return Promise.resolve(this.outcome(spec))
  }

  start(): ShellProcess {
    // The tool-mode job only needs to hand back a process stub whose lifecycle is
    // captured here; `done` never settles in these tests.
    const process = { status: 'running' as const, exitCode: null, signal: null, done: new Promise<void>(() => {}), readOutput: () => ({ delta: '', lossy: false }), kill: () => true }
    return process
  }
}

/** Minimal `ctx.jobs` stub: records start specs and returns a predictable job id. */
class StubJobs {
  readonly starts: JobStart[] = []

  start(spec: JobStart): JobId {
    this.starts.push(spec)
    const hooks = spec.run()
    void hooks.done
    return JobId(`bash-${this.starts.length}`)
  }
}

/** Mount the session store, the stub executor, and the service under test. */
async function mount(
  outcome: (spec: ShellExecSpec) => ShellRunResult = () => clean('out'),
  config: Config = {},
  withJobs = false,
): Promise<{ ctx: Context; executor: StubExecutor; jobs?: StubJobs }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  let executor!: StubExecutor
  const jobs = withJobs ? new StubJobs() : undefined
  if (jobs !== undefined) ctx.provide('jobs', jobs)
  await ctx.plugin((inner: Context) => { executor = new StubExecutor(inner, outcome) })
  await ctx.plugin(ShellCommandService, config)
  return { ctx, executor, ...jobs !== undefined ? { jobs } : {} }
}

/** Mint a scope whose key is a live agent (real session: the executor logs lifecycle events on it). */
async function mintAgentScope(ctx: Context, name: string): Promise<{ scope: Scope; agent: Agent; followup: ReturnType<typeof vi.fn> }> {
  const session = ctx.sessions.create(SessionId(name))
  const followup = vi.fn()
  const agent = { id: session.id, session, followup } as unknown as Agent
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner, agent) })
  return { scope, agent, followup }
}

/** The lifecycle slice of one agent's log. */
function lifecycleOf(agent: Agent): Array<{ type: string; data: unknown }> {
  return agent.session.events
    .filter(event => event.type === 'shell/run' || event.type === 'shell/done')
    .map(event => ({ type: event.type, data: event.data }))
}

function clean(output: string): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: output, truncated: false },
    stderr: { text: '', truncated: false },
  }
}

describe('ShellCommandService', () => {
  it('runs a command through the executor and records the paired lifecycle and triggers followup', async () => {
    const { ctx } = await mount()
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    const execution = await ctx.shellCommand.run(agent, 'echo hi', new AbortController().signal)

    expect(execution.result).toEqual({ kind: 'success' })
    expect(execution.commandId).toMatch(/^sh-[0-9a-f]{8}-\d+$/u)
    expect(lifecycleOf(agent)).toEqual([
      { type: 'shell/run', data: { commandId: execution.commandId, command: 'echo hi', source: { kind: 'user' } } },
      {
        type: 'shell/done',
        data: {
          commandId: execution.commandId,
          kind: 'success',
          exitCode: 0,
          signal: null,
          timedOut: false,
          output: { text: 'out', truncated: false },
        },
      },
    ])
    expect(followup).toHaveBeenCalledTimes(1)
    const msg = followup.mock.calls[0]?.[0] as UserMessage
    expect(msg.role).toBe('user')
    expect(msg.content[0]?.type).toBe('text')
    expect((msg.content[0] as { text: string }).text).toBe(
      'The user executed the shell command: `!echo hi` (exit code 0)\n\nOutput:\n```\nout\n```',
    )
  })

  it('runs in the session working directory when the session header carries one', async () => {
    const { ctx, executor } = await mount()
    const session = ctx.sessions.create(SessionId('dir'), { meta: { cwd: SESSION_CWD } })
    const followup = vi.fn()
    const agent = { id: session.id, session, followup } as unknown as Agent

    await ctx.shellCommand.run(agent, 'pwd', new AbortController().signal)

    expect(executor.specs[0]?.workdir).toBe(SESSION_CWD)
    expect(lifecycleOf(agent)[0]).toMatchObject({ type: 'shell/run', data: { cwd: SESSION_CWD } })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('settles a non-zero exit as an error kind while still resolving success', async () => {
    const { ctx } = await mount(() => ({
      ...clean('boom'),
      exitCode: 2,
      stderr: { text: 'nope', truncated: false },
    }))
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    const execution = await ctx.shellCommand.run(agent, 'false', new AbortController().signal)

    expect(execution.result).toEqual({ kind: 'success' })
    expect(lifecycleOf(agent)[1]).toMatchObject({
      type: 'shell/done',
      data: {
        kind: 'error',
        exitCode: 2,
        output: { text: 'boom\n[stderr]\nnope', truncated: false },
      },
    })
    expect(followup).toHaveBeenCalledTimes(1)
    const msg = followup.mock.calls[0]?.[0] as UserMessage
    expect((msg.content[0] as { text: string }).text).toBe(
      'The user executed the shell command: `!false` (exit code 2)\n\nOutput:\n```\nboom\n[stderr]\nnope\n```',
    )
  })

  it('settles an abort as an error kind', async () => {
    const { ctx } = await mount(() => ({ ...clean(''), aborted: true, exitCode: null }))
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    await ctx.shellCommand.run(agent, 'sleep 10', new AbortController().signal)

    expect(lifecycleOf(agent)[1]).toMatchObject({ type: 'shell/done', data: { kind: 'error', exitCode: null } })
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty command with an error result and logs nothing', async () => {
    const { ctx } = await mount()
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    const execution = await ctx.shellCommand.run(agent, '   ', new AbortController().signal)

    expect(execution.result).toEqual({ kind: 'error', text: 'empty shell command' })
    expect(lifecycleOf(agent)).toEqual([])
    expect(followup).not.toHaveBeenCalled()
  })

  it('marks timeout in the output text', async () => {
    const { ctx } = await mount(() => ({ ...clean('slow'), timedOut: true, exitCode: null, timeoutMs: 5_000 }))
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    await ctx.shellCommand.run(agent, 'slow', new AbortController().signal)

    expect(lifecycleOf(agent)[1]).toMatchObject({
      type: 'shell/done',
      data: {
        kind: 'error',
        timedOut: true,
        output: { text: 'slow\n[timed out after 5000ms]', truncated: false },
      },
    })
    expect(followup).toHaveBeenCalledTimes(1)
    const msg = followup.mock.calls[0]?.[0] as UserMessage
    expect((msg.content[0] as { text: string }).text).toBe(
      'The user executed the shell command: `!slow` (timed out)\n\nOutput:\n```\nslow\n[timed out after 5000ms]\n```',
    )
  })
})

describe('ShellCommandService (tool mode)', () => {
  it('launches the command as a background job, opens shell/run, informs the agent immediately, and does not block', async () => {
    const { ctx, jobs } = await mount(() => clean('out'), { mode: 'tool' }, true)
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    // The command is admitted at once; the RPC must not await the (never
    // settling) background process.
    const execution = await ctx.shellCommand.run(agent, 'sleep 10', new AbortController().signal)

    expect(execution.result).toEqual({ kind: 'success' })
    expect(lifecycleOf(agent)).toEqual([
      { type: 'shell/run', data: { commandId: execution.commandId, command: 'sleep 10', source: { kind: 'user' } } },
    ])

    // One owned bash job named after the command.
    expect(jobs?.starts).toHaveLength(1)
    expect(jobs?.starts[0]?.kind).toBe('bash')
    expect(jobs?.starts[0]?.label).toBe('sleep 10')
    expect(jobs?.starts[0]?.owner).toBe(agent)

    // The agent is told about the running job at once (not at settlement).
    expect(followup).toHaveBeenCalledTimes(1)
    const msg = followup.mock.calls[0]?.[0] as UserMessage
    expect(msg.role).toBe('user')
    expect((msg.content[0] as { type: 'text'; text: string }).text).toBe(
      'The user started the shell command `!sleep 10` as a background job (`bash-1`). It is running now; inspect it with `job_output`, wait on it, or stop it with `job_kill` while it runs.',
    )
  })

  it('uses the session working directory when the session header carries one', async () => {
    const { ctx, executor, jobs } = await mount(() => clean('out'), { mode: 'tool' }, true)
    const session = ctx.sessions.create(SessionId('tool-dir'), { meta: { cwd: SESSION_CWD } })
    const agent = { id: session.id, session, followup: vi.fn() } as unknown as Agent

    await ctx.shellCommand.run(agent, 'pwd', new AbortController().signal)

    expect(executor.specs[0]?.workdir).toBe(SESSION_CWD)
    expect(jobs?.starts[0]?.owner).toBe(agent)
  })

  it('rejects an empty command in the same way regardless of mode', async () => {
    const { ctx } = await mount(() => clean('out'), { mode: 'tool' }, true)
    const { agent, followup } = await mintAgentScope(ctx, 'a')

    const execution = await ctx.shellCommand.run(agent, '   ', new AbortController().signal)

    expect(execution.result).toEqual({ kind: 'error', text: 'empty shell command' })
    expect(lifecycleOf(agent)).toEqual([])
    expect(followup).not.toHaveBeenCalled()
  })
})
