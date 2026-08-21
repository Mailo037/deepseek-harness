/**
 * Shell-command conversation node definition: folds `shell/run` + `shell/done`
 * into one keyed chat node displaying a terminal block.
 *
 * @module @deepseek-ai/dsh-client-ui-shell-command/client
 */

import type { ConversationNodeDefinition, ChatConversationViewNode, ConversationMatch } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-shell-command/types'

/** Final renderer data for one shell command lifecycle. */
export interface ShellCommandChatData {
  /** Start event seq for sortable position. */
  readonly seq: number
  /** Start event time. */
  readonly time: number
  /** Lifecycle pairing id. */
  readonly commandId: string
  /** The trimmed command after the leading `!`. */
  readonly command: string
  /** Working directory, when known. */
  readonly cwd?: string | undefined
  /** Outcome when the command has settled, or null while running. */
  readonly outcome: {
    readonly kind: 'success' | 'error'
    readonly exitCode: number | null
    readonly signal: string | null
    readonly timedOut: boolean
    readonly output: { readonly text: string; readonly truncated: boolean }
  } | null
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable shell command lifecycle. */
    'shell-command': ShellCommandChatData
  }
}

interface ShellState {
  readonly commandId: string
  readonly command: string
  readonly cwd?: string | undefined
  readonly seq: number
  readonly time: number
  readonly outcome: ShellCommandChatData['outcome']
}

function fromRun(match: ConversationMatch): ShellState {
  if (match.event.type !== 'shell/run') throw new Error('shell-command start requires shell/run')
  const data = match.event.data
  return {
    commandId: data.commandId,
    command: data.command,
    ...data.cwd === undefined ? {} : { cwd: data.cwd },
    seq: match.event.seq,
    time: match.event.time,
    outcome: null,
  }
}

function fromDone(match: ConversationMatch, previous: ShellState): ShellState {
  if (match.event.type !== 'shell/done') throw new Error('shell-command update requires shell/done')
  const data = match.event.data
  return {
    commandId: data.commandId,
    command: previous.command,
    ...previous.cwd === undefined ? {} : { cwd: previous.cwd },
    seq: previous.seq,
    time: previous.time,
    outcome: {
      kind: data.kind,
      exitCode: data.exitCode,
      signal: data.signal,
      timedOut: data.timedOut,
      output: { text: data.output.text, truncated: data.output.truncated },
    },
  }
}

/** Durable shell-command event family folded into one keyed chat node. */
export const shellCommandDefinition: ConversationNodeDefinition<ShellState> = {
  kind: 'shell-command',
  target: 'chat',
  match: (event) => {
    if (event.type === 'shell/run') return { id: String(event.data.commandId), role: 'start' }
    if (event.type === 'shell/done') return { id: String(event.data.commandId), role: 'update' }
    return null
  },
  start: (_context, match) => fromRun(match),
  update: (context, match) => fromDone(match, context.state),
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.start === undefined) return null
    const state = context.state as ShellState
    return {
      key: context.key,
      kind: 'shell-command',
      id: context.id,
      target: 'chat',
      anchorSeq: state.seq,
      location: context.start.location,
      visibility: 'visible',
      data: {
        seq: state.seq,
        time: state.time,
        commandId: state.commandId,
        command: state.command,
        ...state.cwd === undefined ? {} : { cwd: state.cwd },
        outcome: state.outcome,
      },
    }
  },
}
