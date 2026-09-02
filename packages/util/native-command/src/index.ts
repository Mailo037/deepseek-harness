/**
 * Shared no-shell `execFile` runner for host-native OS integrations (the
 * native directory chooser, the open-with-default-application hand-off, the
 * git self-update commands): utf8 stdio capture, abort propagation, optional
 * child environment and wall-clock bound, Windows console hide. A library,
 * not a plugin — no ctx, no state, no events.
 * @module @deepseek-ai/dsh-native-command
 */

import { execFile } from 'node:child_process'

/** Optional per-run execFile overrides. */
export interface NativeCommandOptions {
  /** Child environment; absent inherits this process's environment. */
  env?: NodeJS.ProcessEnv | undefined
  /** Hard wall-clock bound in ms; expiry kills the child and rejects the run. */
  timeoutMs?: number | undefined
}

/** Testable command boundary; native implementations never invoke a shell. */
export type NativeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  options?: NativeCommandOptions,
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a host command with utf8 stdio, abort propagation, and Windows hide.
 * @param command - executable path or PATH name.
 * @param args - argv (never a shell string).
 * @param signal - caller/connection lifetime; abort terminates the child.
 * @param options - optional child environment and wall-clock bound.
 * @returns captured stdout/stderr on exit 0.
 */
export const runNativeCommand: NativeCommandRunner = (command, args, signal, options) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        signal,
        windowsHide: true,
        ...(options?.env === undefined ? {} : { env: options.env }),
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const failure = Object.assign(new Error(error.message, { cause: error }), {
            code: error.code,
            stdout,
            stderr,
          })
          reject(failure)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
