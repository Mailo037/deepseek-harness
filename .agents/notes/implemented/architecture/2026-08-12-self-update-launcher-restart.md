# Agent Note: Self-update as a launcher-owned restart behind a loopback wire plane

Status: implemented

English | [中文](2026-08-12-self-update-launcher-restart.zh.md)

## Problem

The GUI had no way to tell what build it was talking to, and no path from "an update exists" to "the app is running it". Three constraints shaped the design:

1. **Where the code lives.** Both surfaces — `dsh web` and the Electron shell — run the host from one git checkout (Electron boots the same web profile in its main process). There is no installer channel, so a release-download updater would have nothing to install; the honest update unit is the checkout itself.
2. **Who may end the process.** Applying an update kills every connected client's host and must abort live agent turns. That is at least as privileged as the settings/credential plane, which is already loopback-pinned in `dsh-client-connection`.
3. **Who owns process replacement.** A plugin cannot respawn the launcher: only the entry that wired signal handlers and the shutdown controller knows how to exit safely, and Electron's restart (`app.relaunch()` + `app.exit`) shares nothing with Node's detached-spawn.

## Decision

**One update plane, two launchers, surface-aware restart, GitHub-first checks.** The `dsh-host-self-update` service owns repository identity (`describe`), cached upstream checks (`check`), agent quiescence (`quiesceAgents`: cancel every live turn with `{ kind: 'user' }, keepInbox: true`, then drain with a bound), and fast-forward-only pulls. The check is GitHub-first because the deployment's checkout tracks a public GitHub fork: a github.com remote answers through one unauthenticated Compare-API request (`HEAD...branch` → `behind_by` + tip), and only non-GitHub remotes fall back to `git fetch`. The gateway's host domain exposes check/apply over the existing wire; both methods join the loopback fence because apply ends the process for every client and check makes the host issue network requests.

Process replacement is a **launcher capability**, not a service: `provideCmdline` grew an optional `appRestart` next to `appExit`. The CLI wires dispose-tree → detached respawn of the same argv → exit; the Electron boot wires `app.relaunch()` → ordinary shutdown. Where the value is absent (embedding hosts), `host.describe` reports `canRestart: false` and the GUI hides the gesture instead of failing late. Surface detection rides `process.versions.electron` into `host.describe.surface` so the About view can name what it is running on.

**Sequencing lives in the wire handler, not the browser:** quiesce → pull → respond ok → schedule the respawn 500 ms out. Responding before scheduling is what makes failures reportable; the delay is what lets the ok response flush before teardown. The client side mirrors this in `UpdateStore.watchRestart`: reload only after it has seen one failed `host.describe` (the old process dropping) followed by a successful one — reloading inside the shutdown window would land on the stale build again.

## Testing

`packages/host/self-update/tests/` covers the git layer against a scripted runner (identity fallbacks, failure classification, ff-only refusal) and the service against a real temp directory carrying `.git` (cache windows, force, quiesce ordering, pull advancement). `packages/host/apiproxy/tests/api-proxy-host-update.spec.ts` drives the wire methods over structural stubs: capability degradation, error-code mapping, quiesce-before-pull ordering, and exactly-one scheduled respawn.
