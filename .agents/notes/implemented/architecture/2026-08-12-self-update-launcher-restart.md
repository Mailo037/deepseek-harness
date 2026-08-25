# Agent Note: Self-update as a launcher-owned restart behind a loopback wire plane

Status: implemented

English | [中文](2026-08-12-self-update-launcher-restart.zh.md)

## Problem

The GUI had no way to tell what build it was talking to, and no path from "an update exists" to "the app is running it". Three constraints shaped the design:

1. **Where the code lives.** Both surfaces — `dsh web` and the Electron shell — run the host from one git checkout (Electron boots the same web profile in its main process). There is no installer channel, so a release-download updater would have nothing to install; the honest update unit is the checkout itself.
2. **Who may end the process.** Applying an update kills every connected client's host and must abort live agent turns. That is at least as privileged as the settings/credential plane, which is already loopback-pinned in `dsh-client-connection`.
3. **Who owns process replacement.** A plugin cannot respawn the launcher: only the entry that wired signal handlers and the shutdown controller knows how to exit safely, and Electron's restart (`app.relaunch()` + `app.exit`) shares nothing with Node's detached-spawn.

## Decision

**One update plane, two launchers, surface-aware restart, GitHub-first checks.** The `dsh-host-self-update` service owns repository identity (`describe`), cached upstream checks (`check`), agent quiescence (`quiesceAgents`: cancel every live turn with `{ kind: 'user' }, keepInbox: true`, then drain with a bound), and fast-forward-only pulls. The check is GitHub-first because the deployment's checkout tracks a public GitHub fork: a github.com remote answers through one unauthenticated Compare-API request (`HEAD...branch` → `ahead_by` + tip), and only non-GitHub remotes fall back to `git fetch`. The gateway's host domain exposes check/apply over the existing wire; both methods join the loopback fence because apply ends the process for every client and check makes the host issue network requests.

Process replacement is launcher-owned and crosses plugin isolation through the always-present `appLifecycle` service: `provideCmdline` supplies `exit` plus optional `restart`. A plain restart keeps dispose-tree → detached respawn of the same argv → exit, while a handoff request carries a no-shell helper command. The CLI starts that helper first and begins disposal only after the operating system confirms spawn; the helper must wait for the parent to exit before taking its resources. Electron ignores the helper form and retains `app.relaunch()` → ordinary shutdown. Where `restart` is absent (embedding hosts), `host.describe` reports `canRestart: false` and the GUI hides the gesture instead of failing late. Surface detection rides `process.versions.electron` into `host.describe.surface` so the About view can name what it is running on.

**Web updates transfer ownership before modifying the checkout:** quiesce → create detached handoff → respond `{ started: true }` → schedule the handoff 500 ms out. The helper waits for the old host to release its authoritative port, serves `GET /__dsh_update/status` there, runs `git pull --ff-only`, runs `pnpm run build`, releases the status server, and runs `pnpm dsh` with the original Web arguments plus the retained `--port` and `--no-open`. The old host never pulls its own source, and a helper spawn failure leaves it serving. The runner launches the captured pnpm entry directly when `npm_execpath` is a native executable (`.exe`/`.cmd`/`.bat`) and as `node <entry>` otherwise, so both the build and restart survive a Windows standalone pnpm install (see [self-update-native-pnpm-launch](../bug-fix/2026-08-25-self-update-native-pnpm-launch.md)). Electron remains quiesce → in-process fast-forward → respond → native relaunch because its application owner supplies the update UI and lifecycle.

The settings client owns the browser projection through the layout's `shell.overlay` slot and portals its full-screen occupant to `document.body` so an already-open settings modal cannot cover it. The initiating tab displays **Applying update** before the outage; every other open tab discovers the same-origin status endpoint while reconnecting. Runner phases map to localized waiting, pulling, building, starting, or failed copy beside an auto-scrolling terminal that retains the latest 80 bounded stdout, stderr, and runner lines. After the replacement host connects, each tab navigates with one `__dsh_update=<update-id>` query to bypass a stale index response, then removes the marker from browser history after load. A failed runner keeps the port and status response so the page shows its error rather than returning to a generic connection-loss screen. It also offers a prefilled GitHub issue draft containing the bounded log tail after automatic token and home-path redaction; the user reviews the draft before submitting it publicly.

## Testing

`packages/host/self-update/tests/` covers the git layer against a scripted runner and pins restart argv normalization. `packages/host/apiproxy/tests/api-proxy-host-update.spec.ts` separates native pull/relaunch from Web handoff and proves the Web host never pulls in-process. CLI and cmdline type checks pin the spawn-before-dispose request. Client tests validate runner-payload rejection, bounded build-log projection, issue-draft redaction, and the cache-busting refresh URL; the assembled Web snapshot owns the visible update transcript.

## Alternatives considered

**Pull and build inside the running host, then respawn.** Rejected because `git pull` may replace the code and build inputs of the process that still owns shutdown. If that process exits or its post-pull path fails, no independent owner remains to rebuild or rebind the port.

**Let the browser run git and pnpm.** Rejected because the browser does not own host subprocess authority or lifecycle shutdown, and granting it command construction would widen the loopback API beyond the bounded update operation.

**Show estimated progress without a temporary status server.** Rejected because every non-initiating tab would see only connection loss and the initiating tab could not distinguish a slow build from a failed runner. The retained same-origin port gives every page one observable update state without adding another exposed port.

**Restart with the original browser-opening flag.** Rejected because an update must not open another browser window. The runner preserves the invocation but makes the resolved port and `--no-open` authoritative.

## Consequences

Web self-update now requires a git checkout launched through pnpm, because the detached runner uses the current pnpm entry — invoked directly when it is a native executable, else under `node` — for both build and restart; rejection happens before the running host shuts down. The runner occupies the original port throughout pull and build, so no other process can claim it during the outage. A failed update deliberately keeps that status server alive and requires user intervention after exposing the bounded diagnostic and reviewable issue draft. The terminal reports observed command output instead of estimating byte-level git or compiler completion. Every open page performs one cache-busting navigation after recovery, while Electron retains its native updater behavior.
