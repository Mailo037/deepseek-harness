/** Resolve the executable command and arguments for spawning pnpm. */

export interface PackageManagerInvocation {
  /** The executable binary to spawn. */
  command: string
  /** Arguments to pass to the binary. */
  args: string[]
}

/**
 * Resolve the command and argument array for a pnpm invocation.
 *
 * When pnpm is invoked through a JavaScript entrypoint (e.g. `pnpm.cjs` or `pnpm.js`),
 * running `node <entrypoint> ...args` avoids Windows shell shims and maintains shell-free child processes.
 * When pnpm is invoked through a native binary executable (e.g. `pnpm.exe` on Windows via Scoop or standalone
 * `@pnpm/exe`, or an ELF/Mach-O binary), spawning through Node fails with `ERR_UNKNOWN_FILE_EXTENSION`.
 * In that case, the native binary is executed directly.
 *
 * @param args - Arguments to pass to pnpm (e.g. `['run', 'build:lib']`).
 * @param entrypoint - Custom entrypoint path, defaulting to `process.env.npm_execpath`.
 * @returns Executable path and argument list ready for `spawn` or `spawnSync`.
 */
export function pnpmInvocation(
  args: readonly string[],
  entrypoint: string | undefined = process.env.npm_execpath,
): PackageManagerInvocation {
  if (entrypoint === undefined || entrypoint === '') {
    throw new Error('pnpm invocation: npm_execpath is unavailable; invoke the runner through a pnpm package script.')
  }
  if (/\.[cm]?[jt]s$/i.test(entrypoint)) {
    return { command: process.execPath, args: [entrypoint, ...args] }
  }
  return { command: entrypoint, args: [...args] }
}
