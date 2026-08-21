# `@deepseek-ai/dsh-host-self-update`

English | [中文](README.zh.md)

Git-backed self-update service (`ctx.selfUpdate`) for a dsh host running from a checkout: repository identity for the GUI's About surface, upstream update checks, safe agent quiescence, and fast-forward pulls. The restart itself is the launcher's [`ctx.appRestart`](../../boot/cmdline/README.md) capability — this service only prepares the tree for it; the wire surface lives in the [API gateway](../apiproxy/README.md)'s host domain (`host.checkUpdate`, `host.applyUpdate`).

Every git fact is read through one no-shell `git` invocation against the configured working tree ([native-command](../../util/native-command/README.md), `GIT_TERMINAL_PROMPT=0`). A directory that is not a checkout, or a host without git, degrades to the explicit unavailable capability instead of failing the load — a built installation legitimately has neither. Update checks against a github.com remote are one public Compare-API request (no network git); other remotes fall back to `git fetch`, and apply/pull still uses local git. Checks are cached per `checkCacheMs` and serialized with pulls so two clients never race two network steps into one tree; a diverged tree refuses with `not-fast-forward` instead of rewriting local history.

Config: `root` (empty = auto-detect the nearest `.git` above this package), `commandTimeoutMs` (10 000), `fetchTimeoutMs` (30 000), `checkCacheMs` (60 000).

## Model Experience

None; this package serves browser-facing settings surfaces and never reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The apply flow trusts the checkout's cleanliness** — local uncommitted changes survive a fast-forward only when they do not overlap updated files; a dirty-tree detection pass is deferred until a real conflict report demands it.
