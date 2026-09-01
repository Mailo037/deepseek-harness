/**
 * `SandboxedFileSystem`: the sandbox-enforcing implementation of the
 * `@deepseek-ai/dsh-fs` Service Definition. It extends `LocalFileSystem` so all
 * text-storage mechanics — resolve, stat, read/stream, list, the atomic
 * write and the read-match-write edit critical section — are the local
 * implementation's, verbatim; this package adds only the per-call POLICY fence
 * on the two mutations. Reads pass through untouched: every mode permits
 * reading.
 *
 * The fence is a policy check in TRUSTED code over a MODEL-CONTROLLED path,
 * NOT a kernel boundary — the operations are the seam's own (open, rename),
 * and only the target path is untrusted, so canonicalize-then-contain is the
 * complete answer to this surface. Kernel-grade isolation of untrusted CODE
 * stays `ctx.shell`'s job (`@deepseek-ai/dsh-bash-sandbox`). This mirrors the
 * `code-runtime` stance: containment, not a security boundary. The residual
 * TOCTOU (an ancestor symlink swapped between the containment re-check and the
 * syscall) is narrowed by re-canonicalizing immediately before delegating and
 * is accepted for this threat model.
 *
 * Per-call policy: `read-only` denies every mutation; `workspace-write` allows
 * a mutation only when the target canonicalizes under the policy's workspace
 * root or a platform temp area (the SAME writable-root set Seatbelt grants,
 * derived from the one `writableRoots` function so bash and fs cannot drift);
 * `danger-full-access` delegates unfenced. A denial throws the structured
 * `FS_SANDBOX_DENIED` — no text inference is needed (unlike bash's kernel
 * stderr), because an in-process fence knows exactly what it refused. The
 * escalation retry lives in the tool layer (`@deepseek-ai/dsh-tool-fs`),
 * exactly as bash's does.
 *
 * On top of the mode fence, an **fs-deny policy** (the `fs-deny` settings
 * namespace) blocks every operation — read AND write — on paths matching the
 * configured patterns, regardless of the session's mode. `danger-full-access`
 * cannot bypass it, and the model sees no escalation offer: the deny is
 * absolute. The check runs on the display path AND the canonical target key,
 * so a symlink alias of a denied path is still denied.
 *
 * @module @deepseek-ai/dsh-fs-sandbox
 */

import { Service, Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-fs-local'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget,
  FsVersion, FsWriteIntent, FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { isDenied, isCommandDenied } from './deny.ts'
import { isPathUnder } from './containment.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Waterfall: whether a shell command is authorized to run.
     * @mode waterfall
     * @param command - Shell command proposed for execution.
     * @param next - Continue authorization through the remaining listeners.
     * @returns Whether the command is authorized.
     */
    'shell/authorize'(this: Context, command: string, next: () => boolean): boolean
  }
}

/** Schemastery schema for the fs-deny settings namespace. */
export const FSDENY_SCHEMA = z.object({ patterns: z.array(String).default([]) })
/** Branded settings namespace key. */
export const FSDENY_NS = settingsNamespace('fs-deny')
/** Resolved value of the fs-deny settings namespace. */
export interface FsDenyConfig { readonly patterns: readonly string[] }

/**
 * Plugin config: the local backend's knobs verbatim (`cwd` resolution default
 * and `diffBasisMaxBytes` overwrite-presentation bound). The sandbox default
 * (mode + `workspace-write` fallback root) is NOT here — `ctx.sandboxPolicy`
 * resolves each calling session for every enforcing capability.
 */
export type Config = LocalConfig

/**
 * Sandbox-enforcing filesystem backend. Registers as `ctx.fs` (loading it
 * INSTEAD OF `dsh-fs-local`, together with a `ctx.sandboxPolicy`, is the whole
 * swap — the model-facing tools are untouched). Its configured default mode is
 * the capability fact exposed by {@link sandboxMode}; `dsh-tool-fs` resolves
 * each session's mode and cwd into a policy for every mutation, while an
 * approved escalation may stamp a strictly wider mode for one call.
 */
export class SandboxedFileSystem extends LocalFileSystem {
  static inject = ['sandboxPolicy', 'settings']

  private readonly defaultMode: SandboxMode
  /** Settings scope for the fs-deny namespace (read synchronously on every call). */
  private denyScope!: import('@deepseek-ai/dsh-settings').SettingsScope<FsDenyConfig>

  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    this.defaultMode = ctx.sandboxPolicy.defaultMode
  }

  /** Register the fs-deny settings namespace (read synchronously on every call). */
  [Service.init](): void {
    this.denyScope = this.ctx.settings.register(FSDENY_NS, FSDENY_SCHEMA)
    // Shell commands referencing denied paths are rejected before execution.
    this.ctx.effect(() => this.ctx.on('shell/authorize', (command, next) => {
      return isCommandDenied(command, this.denyScope.get().patterns) ? false : next()
    }), 'fs-sandbox: shell deny guard')
  }

  /** The deployment default mode — the capability fact the tool layer reads to advertise escalation. */
  override get sandboxMode(): SandboxMode {
    return this.defaultMode
  }

  /**
   * Fence the write by the per-call policy, then delegate to the inherited
   * atomic write. See {@link checkedTarget}.
   * @param target - Target path.
   * @param content - Replacement text.
   * @param expected - Optional atomic-write intent.
   * @param signal - Optional cancellation signal.
   * @param sandboxPolicy - Per-call sandbox policy.
   * @returns The completed write outcome.
   */
  override async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsWriteOutcome> {
    return super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal)
  }

  /**
   * Fence the edit by the per-call policy, then delegate to the inherited
   * atomic edit. See {@link checkedTarget}.
   * @param target - Target path.
   * @param edit - Requested text edit.
   * @param expected - Optional version guard.
   * @param signal - Optional cancellation signal.
   * @param sandboxPolicy - Per-call sandbox policy.
   * @returns The completed edit outcome.
   */
  override async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicy,
  ): Promise<FsEditOutcome> {
    return super.editText(await this.checkedTarget(target, sandboxPolicy), edit, expected, signal)
  }

  /** Deny check on reads: deny matches block regardless of the session mode. */
  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.checkDeny(target)
    return super.readText(target, signal)
  }

  /** Deny check on streaming reads. */
  override streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    this.checkDeny(target)
    return super.streamText(target, signal)
  }

  /** Deny check on binary reads. */
  override async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    this.checkDeny(target)
    return super.readBytes(target, signal, maxBytes)
  }

  /** Deny check on stat. */
  override async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    this.checkDeny(target)
    return super.stat(target, signal)
  }

  /** Deny check on directory listing. */
  override async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    this.checkDeny(target)
    return super.listDir(target, signal)
  }

  /** Deny check on no-follow stat. */
  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    this.checkDenyPath(path)
    return super.lstat(path, opts, signal)
  }

  /**
   * Enforce the per-call policy against `target` and return the EXACT target the
   * mutation must use, so the checked identity is the mutated one (no
   * check-here-write-there TOCTOU). The fs-deny check runs FIRST, on the
   * display path and the canonical key, and blocks every mode including
   * `danger-full-access`. `read-only` denies; `workspace-write`
   * re-canonicalizes NOW (`resolve` realpaths the deepest existing ancestor,
   * reflecting a concurrently swapped symlink), requires containment under a
   * writable root, and returns THAT fresh target; `danger-full-access` returns
   * the caller's target unfenced. Throws the structured `FS_SANDBOX_DENIED` on
   * mode refusal, or `FS_DENY` on a denied path — the tool layer maps the mode
   * denial to the model-facing `[sandbox: …]` marker and the escalation hint;
   * an `FS_DENY` passes through unchanged (no escalation exists against it).
   */
  private async checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget> {
    this.checkDeny(target)
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()
    const { mode } = policy
    if (mode === 'danger-full-access') return target
    if (mode === 'read-only') {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, 'FS_SANDBOX_DENIED')
    }
    // workspace-write: containment on the FRESH canonical path (catches a
    // symlink ancestor swapped since the tool resolved this target), and the
    // mutation delegates with THIS fresh target — never the stale one.
    const fresh = await this.resolve(target.displayPath)
    let contained = false
    for (const root of writableRoots(policy)) {
      if (await isPathUnder(fresh.targetKey, root)) {
        contained = true
        break
      }
    }
    if (!contained) {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, 'FS_SANDBOX_DENIED')
    }
    return fresh
  }

  /** Throw `FS_DENY` when either the display path or the canonical key matches the deny list. */
  private checkDeny(target: FsTarget): void {
    this.checkDenyPath(target.displayPath)
    this.checkDenyPath(target.targetKey)
  }

  /** Throw `FS_DENY` when `path` matches any configured deny pattern. */
  private checkDenyPath(path: string): void {
    if (isDenied(path, this.denyScope.get().patterns)) {
      throw new FsError(
        `[fs-deny] access to "${path}" is denied by the fs-deny policy`,
        'FS_DENY',
      )
    }
  }
}

export default SandboxedFileSystem
