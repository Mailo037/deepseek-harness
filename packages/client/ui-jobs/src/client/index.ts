import type { ClientContext, JobView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { JobListAction, type JobListActionInjected } from './JobListAction.tsx'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps, JobListActionInjected } from './JobListAction.tsx'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale', 'connection']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  const connection = (ctx as unknown as { connection?: { api?: { jobs?: {
    kill(payload: { sessionId: SessionId; jobId: JobId }): Promise<{ ok: boolean }>
    output(payload: { sessionId: SessionId; jobId: JobId }): Promise<{ ok: boolean; value: { text: string; status: JobView['status']; detail?: string } }>
  } } } }).connection

  const jobActions: JobListActionInjected = {
    async killJob(sessionId: SessionId, jobId: JobId): Promise<void> {
      if (connection?.api?.jobs) {
        await connection.api.jobs.kill({ sessionId, jobId })
      }
    },
    async getJobOutput(sessionId: SessionId, jobId: JobId): Promise<{ text: string; status: JobView['status']; detail?: string }> {
      if (connection?.api?.jobs) {
        const res = await connection.api.jobs.output({ sessionId, jobId })
        if (res.ok) {
          return res.value
        }
      }
      return { text: '', status: 'failed', detail: 'Could not fetch logs' }
    },
  }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
      inject: () => jobActions,
    }, JobListAction),
  )
}
