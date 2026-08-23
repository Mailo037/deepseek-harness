# Agent Note: Windows plugin pnpm arguments bypass command shells

Status: implemented

English | [中文](2026-08-22-windows-plugin-pnpm-argv-launch.zh.md)

## Problem

Windows pnpm installations commonly expose `pnpm.cmd`. Starting that wrapper through a command shell made `dsh plugin` arguments such as `&` and `|` command syntax instead of literal values for pnpm.

## Decision

- **Windows pnpm launch:** `apps/cli/src/plugin.ts` finds the pnpm command exposed on PATH, resolves the standard pnpm or Corepack Node entry point beside its shim, and starts that entry through `process.execPath` with `shell: false`. It keeps every supplied argument as one argv value.
- **Other hosts and unavailable pnpm:** POSIX continues to start `pnpm` directly without a shell. A missing Windows entry point reports the existing pnpm-on-PATH diagnostic and exits 127.

## Alternatives considered

- **Keep `shell: true` for `.cmd` shims:** rejected — the shell makes pnpm arguments executable command text.
- **Quote arguments for `cmd.exe`:** rejected — Windows command quoting is not an argv-preserving interface, and a quote rule can regress when arguments contain shell syntax.

## Consequences

The CLI continues to support standard pnpm and Corepack shims while treating metacharacters literally. A custom Windows pnpm wrapper that does not expose either standard Node entry point fails with the pnpm installation diagnostic instead of being executed.

## Testing

The built CLI e2e test installs a temporary pnpm `.cmd` shim and invokes `dsh plugin` with an argument containing `&` plus a Node command. It verifies that the pnpm entry receives the complete literal argument and that the appended command creates no file. A separate Windows probe verifies that an absent pnpm entry reports exit 127 and the pnpm-on-PATH diagnostic.
