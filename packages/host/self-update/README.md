# `@deepseek-ai/dsh-host-self-update`

English | [中文](README.zh.md)

Git-backed self-update service (`ctx.selfUpdate`) for a dsh host running from a checkout: repository identity for the GUI's About surface, upstream update checks, safe agent quiescence, fast-forward pulls, and the CLI Web updater handoff. `createWebUpdateHandoff()` captures the repository, current parent process, authoritative Web host/port, pnpm entry, current CLI arguments, and the cached GitHub issue target. The launcher's [`ctx.appLifecycle.restart`](../../boot/cmdline/README.md) starts the detached helper before shutdown; the helper waits for the parent to release the port, serves `GET /__dsh_update/status` there with its current phase and latest 80 bounded stdout/stderr lines, runs `git pull --ff-only` and `pnpm run build`, then runs `pnpm dsh` with the original Web arguments, the retained `--port`, and `--no-open`. The wire methods live in the [API gateway](../apiproxy/README.md)'s host domain (`host.checkUpdate`, `host.applyUpdate`).

Every git fact is read through one no-shell `git` invocation against the configured working tree ([native-command](../../util/native-command/README.md), `GIT_TERMINAL_PROMPT=0`). A directory that is not a checkout, a host without git, or a checkout not launched through pnpm degrades to an explicit apply failure instead of ending the running host. Update checks against a github.com remote are one public Compare-API request (no network git); other remotes fall back to `git fetch`. Checks are cached per `checkCacheMs` and serialized with in-process pulls so two clients never race two network steps into one tree; both the service pull and detached runner refuse non-fast-forward history.

Config: `root` (empty = auto-detect the nearest `.git` above this package), `commandTimeoutMs` (10 000), `fetchTimeoutMs` (30 000), `checkCacheMs` (60 000).

## Model Experience

None, as this package serves browser-facing settings surfaces and never reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The apply flow trusts the checkout's cleanliness** — local uncommitted changes survive a fast-forward only when they do not overlap updated files; a dirty-tree detection pass is deferred until a real conflict report demands it.
