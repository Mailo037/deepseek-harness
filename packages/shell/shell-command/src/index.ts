/**
 * Human `!` shell command executor: resolves a `!`-prefixed composer line
 * against the composed `ctx.shell` capability seam, records the durable
 * `shell/run`/`shell/done` lifecycle, and returns the admission pairing id.
 * The execution itself is bounded by the executor's configured timeout and
 * output caps; the session's sandbox policy applies exactly as it does to the
 * model's shell tools.
 *
 * The service runs in exactly one of two modes, selected by {@link Config.mode}:
 *
 * - `direct` (default): one-shot synchronous execution. The command runs to
 *   completion in the foreground and the result is reported to the agent as a
 *   single user message only after it settles. This is the historical behavior.
 * - `tool`: the command is launched immediately as an owned `ctx.jobs`
 *   background job and a user message describing the running job is delivered to
 *   the agent right away. The `run` RPC returns immediately (it never blocks on
 *   the command), and the machine can inspect, wait on, or stop the job through
 *   the model-facing `job_output`/`job_kill` tools over its lifetime. The
 *   `shell/done` card settles with the job's final process outcome, so the human
 *   UI terminal block is preserved and the settled output still reaches the
 *   model's next request.
 *
 * @module @deepseek-ai/dsh-shell-command
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { CollectedOutput, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { ShellCommandId } from './brand.ts'
import type { ShellCommandExecution, ShellCommandOutput, ShellCommandResult } from './types.ts'

export { ShellCommandId } from './brand.ts'
export type * from './types.ts'

export const name = 'shell-command'

/** Execution mode for one `!` line in the composed deployment. */
export interface Config {
  /**
   * `direct` runs the command synchronously and reports only after it settles
   * (the historical behavior). `tool` launches it as an owned background job,
   * returns immediately, informs the agent of the running job at once, and lets
   * the machine inspect or stop it via the `job_output`/`job_kill` tools.
   */
  mode?: 'direct' | 'tool'
}

/** Runtime configuration schema for the shell-command plugin. */
export const Config: z<Config> = z.object({
  mode: z.union(['direct', 'tool'] as const).default('direct'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    shellCommand: ShellCommandService
  }
}

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * Merge one settled run's streams into the bounded text the terminal card
 * draws: stdout, then a marked stderr section, then a timeout notice. The
 * exit status stays structured (`exitCode`/`signal`), so the UI draws its own
 * pill instead of parsing a marker back out of the text.
 * @param result - the completed foreground run from the executor.
 * @returns the merged output text plus its truncation flag.
 */
function mergeOutput(result: ShellRunResult): ShellCommandOutput {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)
  let text = out
  if (err.length > 0) {
    // Single newline between sections (stdout usually ends with one already).
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += `[stderr]\n${err}`
  }
  if (result.timedOut) {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += `[timed out after ${result.timeoutMs}ms]`
  }
  return {
    text,
    truncated: result.stdout.truncated || result.stderr.truncated,
  }
}

/**
 * The `ctx.shellCommand` service: one Remote admission entry per `!` line.
 * The gateway resolves the wire session identity to the exact live Agent,
 * whose session carries the working directory and log.
 */
export class ShellCommandService extends TypertRemoteService {
  static inject = ['shell']

  static Config: z<Config> = Config

  /** Monotonic per-instance counter behind {@link mintCommandId}. */
  private commandSeq = 0
  /** Instance token keeping minted ids unique across process restarts over one resumed log. */
  private readonly instanceToken = crypto.randomUUID().slice(0, 8)
  /** The resolved execution mode chosen at construction. */
  private readonly mode: 'direct' | 'tool'

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'shellCommand')
    this.mode = config.mode ?? 'direct'
  }

  /**
   * Execute one `!` shell command against the composed `ctx.shell` executor
   * and record its durable lifecycle. The command runs in the session's
   * working directory under the session's resolved sandbox policy; the
   * executor applies its configured timeout and output bounds.
   *
   * In `direct` mode a settled command — clean, non-zero exit, signal, timeout,
   * or caller cancellation — resolves with `result.kind: 'success'` because the
   * `shell/done` event owns the presentation; only an infrastructure failure
   * that prevents settling (e.g. a sandbox runner that cannot launch) throws.
   * In `tool` mode the RPC resolves immediately after the command is admitted
   * as a background job; the machine observes its lifecycle through the
   * model-facing job tools and the settled `shell/done` card.
   *
   * @param agent - exact live agent whose session receives the lifecycle.
   * @param command - the trimmed line after the leading `!`.
   * @param signal - cancellation owned by the dispatching UI request; a signal
   *   abort in `direct` mode kills the command; `tool` mode honors its own job
   *   cancellation and ignores the dispatching signal once the job is admitted.
   * @returns the lifecycle pairing id and admission outcome.
   */
  @Remote('run')
  async run(agent: Agent, command: string, signal: AbortSignal): Promise<ShellCommandExecution> {
    const trimmed = command.trim()
    if (trimmed === '') {
      const result: ShellCommandResult = { kind: 'error', text: 'empty shell command' }
      return Object.freeze({ commandId: this.mintCommandId(), result: Object.freeze(result) })
    }
    const session = agent.session
    const headerCwd = session.header.cwd
    const commandId = this.mintCommandId()
    this.appendLifecycle(session, 'shell/run', {
      commandId,
      command: trimmed,
      ...headerCwd === undefined ? {} : { cwd: headerCwd },
      source: { kind: 'user' },
    })
    if (this.mode === 'tool') {
      return this.runToolMode(agent, commandId, trimmed, headerCwd)
    }
    return this.runDirect(agent, commandId, trimmed, headerCwd, signal)
  }

  /** One-shot foreground execution: run, settle `shell/done`, then report to the agent. */
  private async runDirect(
    agent: Agent,
    commandId: ShellCommandId,
    trimmed: string,
    headerCwd: string | undefined,
    signal: AbortSignal,
  ): Promise<ShellCommandExecution> {
    const session = agent.session
    const sandboxPolicy = this.ctx.get('sandboxPolicy')
    const policy = sandboxPolicy?.resolve({ session })
    const spec = this.ctx.shell.resolve({
      command: trimmed,
      ...headerCwd === undefined ? {} : { workdir: headerCwd },
      signal,
      ...policy === undefined ? {} : { sandboxPolicy: policy },
    })
    const runResult = await this.ctx.shell.run(spec)
    const clean = !runResult.aborted && !runResult.timedOut && runResult.signal === null && runResult.exitCode === 0
    const output = mergeOutput(runResult)
    this.appendLifecycle(session, 'shell/done', {
      commandId,
      kind: clean ? 'success' : 'error',
      exitCode: runResult.exitCode,
      signal: runResult.signal,
      timedOut: runResult.timedOut,
      output,
    })
    const statusText = runResult.timedOut
      ? 'timed out'
      : runResult.signal !== null
        ? `terminated by signal ${runResult.signal}`
        : `exit code ${runResult.exitCode ?? 0}`
    const outputSection = output.text.length > 0
      ? `\n\nOutput:\n\`\`\`\n${output.text}\n\`\`\``
      : '\n\n(no output)'
    const userMessage = createUserMessage({
      content: [{
        type: 'text',
        text: `The user executed the shell command: \`!${trimmed}\` (${statusText})${outputSection}`,
      }],
      source: { kind: 'user' },
    })
    agent.followup(userMessage)
    const admissionResult: ShellCommandResult = { kind: 'success' }
    return Object.freeze({ commandId, result: Object.freeze(admissionResult) })
  }

  /**
   * Launch a `!` line as an owned background job and inform the agent of the
   * running job immediately. The RPC returns as soon as the job is admitted —
   * it never waits on the command. The agent receives a user message naming the
   * job id, so the machine can inspect, wait on, or stop it via
   * `job_output`/`job_kill` over its lifetime. The `shell/done` card settles
   * from the job's final process outcome.
   */
  private runToolMode(agent: Agent, commandId: ShellCommandId, trimmed: string, headerCwd: string | undefined): ShellCommandExecution {
    const jobId = this.startJob(agent, commandId, trimmed, headerCwd)
    const notice = createUserMessage({
      content: [{
        type: 'text',
        text: `The user started the shell command \`!${trimmed}\` as a background job (\`${jobId}\`). It is running now; inspect it with \`job_output\`, wait on it, or stop it with \`job_kill\` while it runs.`,
      }],
      source: { kind: 'user' },
    })
    agent.followup(notice)
    const admissionResult: ShellCommandResult = { kind: 'success' }
    return Object.freeze({ commandId, result: Object.freeze(admissionResult) })
  }

  /** Start the owned background job for a `!` line and wire its settled card. */
  private startJob(agent: Agent, commandId: ShellCommandId, trimmed: string, headerCwd: string | undefined): string {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) {
      throw new Error('background jobs unavailable for `!` tool mode: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    const sandboxPolicy = this.ctx.get('sandboxPolicy')
    const policy = sandboxPolicy?.resolve({ session: agent.session })
    const request = {
      command: trimmed,
      ...headerCwd === undefined ? {} : { workdir: headerCwd },
      ...policy === undefined ? {} : { sandboxPolicy: policy },
    }
    const id = jobs.start({
      kind: 'bash',
      label: trimmed,
      owner: agent,
      run: () => {
        const proc = this.ctx.shell.start(this.ctx.shell.resolve(request))
        const outcome = proc.done.then(() => {
          const clean = proc.status !== 'killed' && proc.exitCode === 0
          this.appendLifecycle(agent.session, 'shell/done', {
            commandId,
            kind: clean ? 'success' : 'error',
            exitCode: proc.exitCode,
            signal: proc.signal,
            timedOut: false,
            // The full output stays with the job for `job_output`; the settled
            // card carries only the status pill.
            output: { text: '', truncated: false },
          })
          return {
            status: proc.status === 'killed' ? 'killed' as const : 'completed' as const,
            detail: proc.status === 'killed'
              ? (proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit')
              : `exit code: ${proc.exitCode ?? 0}`,
          }
        })
        return {
          cancel: () => void proc.kill(),
          done: outcome,
          readOutput: () => proc.readOutput().delta,
        }
      },
    })
    return id
  }

  /** Mint the next pairing id (monotonic; instance-token-prefixed so a resumed log never repeats one). */
  private mintCommandId(): ShellCommandId {
    this.commandSeq += 1
    return ShellCommandId(`sh-${this.instanceToken}-${this.commandSeq}`)
  }

  /**
   * Append one log-only lifecycle event directly: no turn is opened for it and
   * no flush is forced — persistence observes the eager `session/event` path
   * and drains at ordinary checkpoints and teardown, like every other
   * standalone plugin event.
   */
  private appendLifecycle<T extends 'shell/run' | 'shell/done'>(
    session: Session,
    type: T,
    data: SessionEventMap[T],
  ): SessionEvent<T> {
    // Both admitted types are log-only (non-surface), but TypeScript does not
    // reduce Session.append's conditional rest parameter through a generic
    // type parameter. Preserve the proven two-argument call shape.
    const appendLogOnly = session.append.bind(session) as (eventType: T, eventData: SessionEventMap[T]) => SessionEvent<T>
    return appendLogOnly(type, data)
  }
}

export default ShellCommandService
