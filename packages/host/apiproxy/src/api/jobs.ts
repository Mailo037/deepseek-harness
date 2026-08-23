/**
 * Browser-safe background-job domain contract. The registry's live records
 * never cross the wire; a view is the subset a human list needs, minted fresh
 * per push.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * One background job as the client sees it.
 *
 * Three registry fields are deliberately absent. `ownerSession` is redundant
 * beside the frame's own `sessionId`; `reported` is an internal notice-delivery
 * bit with no user meaning; `outputLimitBytes` is producer-owned model
 * presentation policy that never reaches a human surface.
 */
export interface JobView {
  /** Registry-issued `<kind>-N` identity, stable for the task's whole life. */
  id: JobId
  /**
   * Producer kind (`bash`, `pwsh`, `pty-send`, `subagent`, …). Kept as a bare
   * string because producer plugins extend the kind map by declaration merging,
   * so no client build can enumerate the closed set.
   */
  kind: string
  /** Producer-supplied one-line label: the command, or the delegation description. */
  label: string
  /** Current lifecycle state. */
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Kind-specific status detail ('exit code: 3'), present once the producer supplied one. */
  detail?: string
  /** Epoch ms when the task was registered. */
  startedAt: number
  /** Epoch ms when the task settled; absent while live. */
  finishedAt?: number
}

/** Background-job unary methods (the map keys job.* of RpcMethodMap). */
export interface JobsApi {
  /** Request cancellation of a live background job. */
  kill(
    request: RpcRequest<{ sessionId: SessionId; jobId: JobId; reason?: string }>,
  ): Promise<RpcResponse<{ result: 'requested' | 'already-finished' }>>
  /** Read latest output or final output and status of a background job. */
  output(
    request: RpcRequest<{ sessionId: SessionId; jobId: JobId }>,
  ): Promise<RpcResponse<{ text: string; status: JobView['status']; detail?: string }>>
}
