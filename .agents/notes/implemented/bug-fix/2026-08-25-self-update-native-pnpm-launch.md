# Agent Note: Self-update launches native pnpm executables for the detached build and restart

Status: implemented

English | [中文](2026-08-25-self-update-native-pnpm-launch.zh.md)

## Problem

The detached self-update runner restarts the web host after `git pull` and `pnpm run build`. It spawned pnpm as `spawn(plan.node, [plan.pnpmCli, ...])`, always treating `npm_execpath` as a Node script. On Windows a standalone pnpm (`@pnpm/exe`, a Scoop shim) sets `npm_execpath` to the native `pnpm.exe` binary, so running it through `node` threw `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".exe"`. Every update aborted at the build step and the GUI reported "Update failed", so users could not apply any release.

## Decision

`packages/host/self-update/src/startup.ts` resolves how to run the pnpm CLI from the plan's `pnpmCli` before both the build command and the restart spawn:

- A `.exe`, `.cmd`, or `.bat` entrypoint is a native executable and is spawned directly.
- Any other entrypoint (the `.cjs`/`.js` pnpm shim) stays a Node script and runs as `node <pnpmCli>`.

The build becomes `command(pnpmLaunch.executable, [...pnpmLaunch.prefix, 'run', 'build'], ...)`; the restart spawns `pnpmLaunch.executable` with `[...pnpmLaunch.prefix, ...plan.restartArgs.slice(1)]`, dropping the embedded pnpm entry at index 0 that the handoff plan stores.

This is the same rule the repository scripts use in [pnpm-binary-invocation](2026-08-23-pnpm-binary-invocation.md), but it cannot reuse that helper: `scripts/` is root tooling, and the shipped `self-update` package cannot import across the package boundary (its tsconfig `rootDir` is `src`). The helper therefore lives in the package that owns the runner. This updates the [self-update-launcher-restart](../architecture/2026-08-12-self-update-launcher-restart.md) mechanism, which previously assumed `node <pnpmCli>` for both build and restart.

The failure overlay's issue button is restyled alongside it: it used the undefined `--dsw-alias-bg-elevated` token, which fell back to `#fff` in the dark terminal theme and left dark label text on a white button. It now uses the real `--dsw-alias-button-elevated-fill` and `--dsw-alias-button-floating-hover` tokens, and a `mark-github` 16px glyph (`IconGithubMark16` in `packages/client/ui-primitives/src/icons/index.tsx`) leads the label so the link reads as a GitHub action.

## Alternatives considered

**Always spawn pnpm from PATH.** Rejected — it ignores the package-manager instance that invoked the update and risks an incompatible global pnpm, while the detached runner must reproduce the exact build and restart environment the host used.

**Reuse `scripts/pnpm-invocation.ts`.** Rejected — a shipped package cannot import repo-root scripts, so the small detection rule is duplicated where the runner owns it rather than imported.

**Keep `node <pnpmCli>` and special-case a `.cmd`/`.exe` shim.** Rejected — Node does not execute native executables at all, so there is no reliable `node`-launched path for them.

## Consequences

Windows self-update now completes `pnpm run build` and restarts the host instead of failing at the pnpm invocation; the `.cjs` pnpm path is unchanged. The "Update failed" screen is no longer produced by a healthy build, and its issue button is legible in both themes.

## Testing

`packages/client/ui-primitives/tests/icons.client.spec.tsx` covers the new `IconGithubMark16`. `packages/client/ui-settings-general/tests/applying-update-overlay.client.spec.tsx` asserts a GitHub-marked issue link renders on a failed update. `packages/host/self-update/tests/service.spec.ts` pins the unchanged handoff plan, and the `.cjs`-script launch path is preserved by the detection rule.
