/**
 * Model-facing `create_session` tool over the host gateway's session plane.
 * The tool derives the target from the calling session (its workspace or cwd
 * and its preset), asks the approval seam BEFORE anything is created — a chat
 * birth is a user-visible sidebar mutation the model cannot undo — and reports
 * only stable identity fields. The gateway owns the actual creation, so no
 * second session-creation path exists.
 * @module @deepseek-ai/dsh-tool-session-start
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: resolves the `ctx.apiProxy` Context merge behind the gateway face.
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import { RpcId, type RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-session-start'
export const inject = ['tools', 'apiProxy']

/** Configures the tool. All fields are optional; the defaults are the shipped behavior. */
export interface Config {
  /**
   * Whether the calling agent's preset is reused for the new chat. `false`
   * composes the deployment default.
   * @default true
   */
  inheritPreset?: boolean
}

export const Config: z<Config> = z.object({
  inheritPreset: z.boolean().default(true),
})

/** Canonical output of `create_session`. */
export interface SessionStartResult {
  /** The created chat's stable id; the browser learns it through the host stream. */
  sessionId: SessionId
  /** Working directory the new chat was created in (the caller's project path). */
  cwd: string
  /** Agent preset the new chat's agent was composed from; absent without a roster. */
  agentPreset?: string
  /**
   * How the caller's project was resolved: `workspace` — a registered
   * workspace accounts the caller and the new chat joined it; `cwd` — no
   * workspace covers the caller, so the chat inherited the caller's recorded
   * cwd directly (an ungrouped chat).
   */
  workspaceSource: 'workspace' | 'cwd'
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    cwd: { type: 'string', required: true },
    agentPreset: { type: 'string' },
    workspaceSource: { type: 'string', required: true, enum: ['workspace', 'cwd'] },
  },
} as const

/** Model-facing statement of when this tool may be called. */
const TOOL_DESCRIPTION =
  'Start a new chat (session) on this host, inside your own chat\'s workspace. Call this ONLY '
  + 'when the user explicitly asks for a new chat or a separate conversation — never to work '
  + 'around a long context, and never speculatively. The new chat starts empty and appears in '
  + 'the user\'s sidebar; the user must confirm the creation through the approval prompt before '
  + 'anything is created. The tool does not switch the user to the new chat and does not carry '
  + 'this conversation\'s history over. For task delegation use the subagent tools instead; '
  + 'this tool only opens an empty chat for the user.'

/** Approval-reason text shown to the confirming user. */
function reasonText(cwd: string): string {
  return `Start a new chat in ${cwd}. The chat is created empty and appears in the sidebar.`
}

/** The caller's project: the workspace accounting it, else its recorded cwd. */
interface StartTarget {
  readonly cwd: string
  /** Registered workspace id to create the chat in; undefined keeps it ungrouped. */
  readonly workspaceId: string | undefined
}

function resolveTarget(ctx: Context, caller: Agent): StartTarget {
  const cwd = caller.session.header.cwd
  if (cwd === undefined) {
    throw new Error('create_session: the calling session records no working directory, so no workspace can be derived for the new chat')
  }
  const workspace = ctx.get('workspaceRegistry')?.findBySessionId(caller.session.id)
  return {
    cwd,
    ...workspace === undefined ? { workspaceId: undefined } : { workspaceId: String(workspace.id) },
  }
}

/** Whether one approval outcome allows the session birth; every non-grant denies. */
function isGrant(outcome: string): boolean {
  return outcome === 'allowed-once'
}

export function apply(ctx: Context, config: Config = {}): void {
  const inheritPreset = config.inheritPreset ?? true
  // Serialized so two approved calls produce chats in call order, not in
  // creation races. The gateway serializes one identity; this serializes the
  // tool's own calls.
  let creationChain: Promise<unknown> = Promise.resolve()

  ctx.tools.register(defineTool({
    name: 'create_session',
    description: TOOL_DESCRIPTION,
    parameters: {},
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value): ContentBlock[] => [{
        type: 'text',
        text: [
          `Started a new chat ${value.sessionId} in ${value.cwd}.`,
          value.agentPreset === undefined ? undefined : `It runs the "${value.agentPreset}" agent preset.`,
          'Tell the user it is ready in the sidebar. Do not claim they are viewing it now.',
        ].filter(part => part !== undefined).join(' '),
      }],
    },
    presentCall: () => ({
      card: 'generic' as const,
      title: 'Start a new chat',
      kind: 'execute' as const,
    }),
    async execute(_args, exec) {
      const caller = exec.agent
      if (caller === undefined) {
        throw new Error('create_session: requires the calling agent; direct registry calls cannot start a session')
      }
      if (caller.session.header.parentSession !== undefined) {
        throw new Error('create_session: only a top-level chat can start another chat; subagent sessions cannot')
      }
      const approval = ctx.get('approval')
      if (approval === undefined) {
        throw new Error('create_session: this deployment composes no approval service; a new chat requires the user\'s confirmation, so the call is refused')
      }
      const target = resolveTarget(ctx, caller)
      const outcome = await approval.request({
        agent: caller,
        toolName: 'create_session',
        callId: exec.callId,
        reason: reasonText(target.cwd),
        signal: exec.signal,
      })
      if (!isGrant(outcome)) {
        throw new Error(`create_session: the user did not approve starting a new chat (${outcome}); no session was created`)
      }
      const presets = ctx.get('agentPresets')
      const requestedPreset = inheritPreset ? presets?.composedPreset(caller.ctx) : undefined
      const operation = creationChain.then(async () => {
        const response = await ctx.apiProxy.sessions.create({
          rpcId: RpcId(randomUUID()),
          payload: {
            ...target.workspaceId === undefined ? { cwd: target.cwd } : { workspaceId: target.workspaceId as never },
            ...requestedPreset === undefined ? {} : { agentPreset: requestedPreset },
          },
        })
        return settle(response, target)
      })
      creationChain = operation.then(() => undefined, () => undefined)
      return operation
    },
  }))
}

/** Unwrap the gateway's echo-checked response into the canonical tool value. */
function settle(
  response: RpcResponse<{ sessionId: SessionId; agentPreset?: string }>,
  target: StartTarget,
): SessionStartResult {
  if (!response.result.ok) {
    throw new Error(`create_session: session creation failed: ${response.result.error.message}`)
  }
  const { sessionId, agentPreset } = response.result.value
  return {
    sessionId,
    cwd: target.cwd,
    ...agentPreset === undefined ? {} : { agentPreset },
    workspaceSource: target.workspaceId === undefined ? 'cwd' : 'workspace',
  }
}
