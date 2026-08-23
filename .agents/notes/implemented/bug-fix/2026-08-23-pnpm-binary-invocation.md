# Agent Note: Support binary pnpm executables in scripts and gate runners

Status: implemented

English | [中文](2026-08-23-pnpm-binary-invocation.zh.md)

## Problem

When pnpm is installed as a compiled binary executable (such as `pnpm.exe` on Windows through Scoop or standalone `@pnpm/exe`), Node sets `process.env.npm_execpath` to the path of that binary. Scripts such as `scripts/build.ts`, `scripts/run-gates.ts`, `scripts/run-web-snapshots.ts`, and `scripts/coverage-partitions.ts` attempted to run `spawn(process.execPath, [npm_execpath, ...args])`, assuming `npm_execpath` was always a JavaScript entry point. This caused Node to throw `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".exe"` when executing repository scripts on systems with binary pnpm installations.

## Decision

- **Unified pnpm invocation helper:** Introduce `scripts/pnpm-invocation.ts` exporting `pnpmInvocation(args, entrypoint?)`.
- **Format detection:** If the entrypoint has a JavaScript file extension (`.cjs`, `.js`, `.mjs`, `.ts`), spawn via `process.execPath` to execute the script in Node and avoid Windows `.cmd` shell invocation. If the entrypoint is a native executable (such as `.exe` or a standalone binary), execute it directly without passing `process.execPath` as the command.
- **Repository scripts:** Refactor `scripts/build.ts`, `scripts/run-gates.ts`, `scripts/run-web-snapshots.ts`, and `scripts/coverage-partitions.ts` to use `pnpmInvocation`.

## Alternatives considered

- **Always spawn `process.execPath`:** rejected — Node fails with `ERR_UNKNOWN_FILE_EXTENSION` when passed a native binary executable.
- **Always invoke `pnpm` from `PATH`:** rejected — ignores the specific package manager instance that invoked the script and risks picking up an incompatible global version.

## Consequences

Repository build, gate, and test scripts function seamlessly on both Node-script and standalone binary pnpm installations without shell wrappers.

## Testing

Added unit tests in `scripts/pnpm-invocation.spec.ts` covering JavaScript entrypoints, Windows `.exe` binaries, standalone Linux/macOS binaries, and missing entrypoint rejection. Verified that `pnpm run build` succeeds cleanly.
