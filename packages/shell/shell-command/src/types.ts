/**
 * Durable shell-command event vocabulary shared with type-only consumers.
 * Client-safe: nothing here reaches a Host-only symbol.
 *
 * @module @deepseek-ai/dsh-shell-command/types
 */

import type { ShellCommandId } from './brand.ts'

/**
 * Producer record for one shell command invocation (the `shell/run` event's
 * source slot). Merge-extensible sum type; today the sole issuer is a
 * human-facing UI surface dispatching a human-typed `!` line.
 */
export interface ShellCommandSourceMap {
  user: { kind: 'user' }
}

/** The union over {@link ShellCommandSourceMap} — who issued a `!` line. */
export type ShellCommandSource = ShellCommandSourceMap[keyof ShellCommandSourceMap]

/** Bounded terminal output retained for one settled shell command. */
export interface ShellCommandOutput {
  /** Merged stdout/stderr text, marker-free (the UI draws its own exit pill). */
  text: string
  /** Whether the executor dropped output beyond its configured bound. */
  truncated: boolean
}

/**
 * The executor's normalized admission outcome returned over the wire. The
 * durable `shell/run`/`shell/done` events own the presentation; a failed
 * command still resolves as `success` here so the dispatching composer
 * commits its draft and the flow node renders the failure.
 */
export type ShellCommandResult =
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly text: string }

/** One settled shell command: the lifecycle pairing id plus the admission outcome. */
export interface ShellCommandExecution {
  /** Pairing id carried by this execution's lifecycle events. */
  readonly commandId: ShellCommandId
  /** The executor's normalized admission outcome. */
  readonly result: ShellCommandResult
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A resolved `!` shell command entered execution. Log-only (never model
     * surface); paired with `shell/done` by `commandId`, mirroring the
     * `command/run`↔`command/done` pairing. The payload is structured —
     * `command` is the trimmed line after the leading `!`, so a consumer
     * never re-parses it.
     */
    'shell/run': {
      commandId: ShellCommandId
      command: string
      /** Working directory the command ran in, when the session carries one. */
      cwd?: string
      source: ShellCommandSource
    }
    /**
     * The paired shell command settled. `kind` mirrors the rendered outcome:
     * `success` for a clean exit, `error` for a non-zero exit, a signal, a
     * timeout, or a kill. The structured exit fields let a terminal
     * presentation draw the status pill; `output` carries the bounded merged
     * stdout/stderr text.
     */
    'shell/done': {
      commandId: ShellCommandId
      kind: 'success' | 'error'
      exitCode: number | null
      signal: string | null
      timedOut: boolean
      output: ShellCommandOutput
    }
  }
}
