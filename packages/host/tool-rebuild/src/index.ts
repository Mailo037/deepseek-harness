/**
 * Model-facing `rebuild_harness` tool over the web host's restart path. It
 * stops the calling agent's running background jobs, records them in the
 * logged result for the post-restart resume, and rebuilds + restarts the web
 * host through the detached self-update helper with `pull: false`. The
 * restart waits for the calling turn to end, so the result — the durable job
 * list — is in the session log before the process exits.
 * @module @deepseek-ai/dsh-tool-rebuild
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SelfUpdateService } from '@deepseek-ai/dsh-host-self-update'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-rebuild'
export const inject = ['tools']

/** Configures how long stopped background jobs may take to settle. */
export interface Config {
  /**
   * Wall-clock bound in ms for waiting out one job's settlement after its
   * cancellation request; a job still live at the bound is recorded as is.
   * @default 10_000
   */
  jobStopTimeoutMs: number
}

export const Config: z<Config> = z.object({
  jobStopTimeoutMs: z.natural().default(10_000),
})

/** One stopped background job as the logged rebuild record states it. */
export interface RebuildStoppedJob {
  id: string
  kind: string
  label: string
  status: JobSnapshot['status']
}

/** Canonical output of `rebuild_harness`. */
export interface RebuildResult {
  /**
   * Whether this call armed the post-turn restart. `false` means a rebuild
   * was already pending; this call still stopped any newly running jobs.
   */
  rebuildScheduled: boolean
  /** The caller's jobs that were live at call time and their recorded status. */
  stoppedJobs: RebuildStoppedJob[]
}

const STOPPED_JOB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    label: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['running', 'stopping', 'completed', 'killed', 'failed'],
    },
  },
} as const

const REBUILD_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rebuildScheduled: { type: 'boolean', required: true },
    stoppedJobs: { type: 'array', required: true, items: STOPPED_JOB_SCHEMA },
  },
} as const

/** Delay between scheduling the process replacement and requesting it, so the flushed result reaches the log and transport first. */
const RESTART_FLUSH_DELAY_MS = 500

/** Default cooperative budget for the tool call itself. */
const TOOL_TIMEOUT_MS = 30_000

/** One-line account of the stopped jobs for the model-facing result text. */
function stoppedJobsText(jobs: readonly RebuildStoppedJob[]): string {
  if (jobs.length === 0) return 'No running background jobs of yours needed stopping.'
  return [
    'Stopped your running background jobs:',
    ...jobs.map(job => `- ${job.id} [${job.kind}] ${job.label} -> ${job.status}`),
  ].join('\n')
}

export function apply(ctx: Context, config: Config): void {
  const jobStopTimeoutMs = config.jobStopTimeoutMs
  /** Whether a rebuild is armed for the calling agent's next idle point; the plugin fiber's disposal disarms it. */
  let armed = false
  ctx.effect(() => () => { armed = false })

  /**
   * Quiesce every agent, then hand the process to the detached rebuild helper.
   * Runs from the calling agent's idle callback, so this turn's result — the
   * durable job record — is already logged.
   */
  const restartAfterTurn = async (selfUpdate: SelfUpdateService): Promise<void> => {
    await selfUpdate.quiesceAgents()
    if (!armed) return
    const server = ctx.get('webServer')
    const restart = ctx.get('appLifecycle')?.restart
    if (server === undefined || restart === undefined) return
    const handoff = selfUpdate.createWebUpdateHandoff(
      { host: server.host, port: server.port },
      { pull: false },
    )
    // Let the logged result and any streaming tail reach the session log and
    // the transport before teardown begins; the api-proxy apply flow uses the
    // same posture.
    setTimeout(() => { restart(handoff) }, RESTART_FLUSH_DELAY_MS)
  }

  ctx.tools.register(defineTool({
    name: 'rebuild_harness',
    description:
      'Rebuild the harness from the current checkout and restart this web host. '
      + 'Stops your running background jobs (they are listed in the result), then after this turn '
      + 'ends the host exits, a helper runs `pnpm run build`, and the same web host relaunches. '
      + 'After the restart, restart the jobs listed in the result before resuming other work.',
    parameters: {},
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => false,
    output: {
      schema: REBUILD_RESULT_SCHEMA,
      render: (_args, value): ContentBlock[] => [{
        type: 'text',
        text: value.rebuildScheduled
          ? `${stoppedJobsText(value.stoppedJobs)}\nThe web host exits after this turn ends; a detached helper `
            + 'then runs `pnpm run build` and relaunches the same host. When you run again after the '
            + 'restart, restart the stopped jobs listed above before resuming other work.'
          : 'A harness rebuild is already scheduled; the web host exits after the turn that scheduled '
            + `it ends.\n${stoppedJobsText(value.stoppedJobs)}`,
      }],
    },
    async execute(_args, exec) {
      const caller = exec.agent
      if (caller === undefined) {
        throw new Error('rebuild_harness: requires the calling agent; direct registry calls cannot schedule a host restart')
      }
      const restart = ctx.get('appLifecycle')?.restart
      if (restart === undefined) {
        throw new Error('rebuild_harness: this launcher cannot replace its own process (no appLifecycle.restart)')
      }
      const selfUpdate = ctx.get('selfUpdate')
      if (selfUpdate === undefined) {
        throw new Error('rebuild_harness: this deployment composes no self-update provider')
      }
      const webServer = ctx.get('webServer')
      if (webServer === undefined) {
        throw new Error('rebuild_harness: rebuilding requires the web host; no webServer service is mounted')
      }

      const stoppedJobs: RebuildStoppedJob[] = []
      const jobs = ctx.get('jobs')
      if (jobs !== undefined) {
        const live = jobs.list(caller)
          .filter(job => job.status === 'running' || job.status === 'stopping')
        for (const job of live) jobs.kill(job.id, caller, 'harness rebuild')
        const settled = await Promise.all(live.map(async (job) => {
          try {
            const snapshot = await jobs.wait(job.id, jobStopTimeoutMs, caller, exec.signal)
            return { id: snapshot.id, kind: snapshot.kind, label: snapshot.label, status: snapshot.status }
          } catch {
            // The caller's signal aborted mid-wait (the tool's timeout policy);
            // the list snapshot is the best record left.
            return { id: job.id, kind: job.kind, label: job.label, status: job.status }
          }
        }))
        stoppedJobs.push(...settled)
      }
      if (exec.signal.aborted) {
        throw new Error('rebuild_harness: aborted while waiting for background jobs to stop; nothing scheduled')
      }

      if (armed) return { rebuildScheduled: false, stoppedJobs }
      armed = true
      void caller.whenIdle().then(
        () => {
          if (!armed) return
          restartAfterTurn(selfUpdate).catch((error: unknown) => {
            // The restart cannot report through the ended turn; the host log is
            // the only remaining surface.
            ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          })
        },
        () => {},
      )
      return { rebuildScheduled: true, stoppedJobs }
    },
    presentCall: () => ({
      card: 'generic' as const,
      title: 'Rebuild harness and restart the web host',
      kind: 'execute' as const,
    }),
  }))
}
