# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings shell, ownerless copy, and durable product-onboarding namespace. It occupies `sidebar.settings` with the trigger chrome and modal settings panel, projects the `settings.section` ledger into the navigation and the `settings.onboarding` ledger into one mounted step at a time, and registers everything on the Settings pages that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General and About sections, the `settings.general.item` slot, and the `settings` dictionaries. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance), sections (Models), and conditional onboarding steps stay with their feature packages. The modal panel is a single column: a header row with the title top-left and the section actions plus close button top-right, the horizontally scrolling section tab row beneath it, and the options area that owns all vertical scrolling. Below 640px the panel becomes a full-screen sheet with the same structure at tighter padding, so the content never squeezes to a sliver on phone viewports.

The About section renders the host installation's identity from the shared describe mirror — version, surface (Web/Desktop), git branch, short commit, remote URL — plus its update state from one shared `UpdateStore`: a manual check and one-click **Update and restart** when the host reports newer upstream commits. During a Web update, a `shell.overlay` occupant replaces the ordinary connection-loss view with **Applying update**, localized pull/build/start status, and an auto-scrolling terminal capped to the runner's latest 80 stdout/stderr lines. Every open tab polls the detached runner on the retained origin while reconnecting; after the new host answers, each tab navigates once with a cache-busting `__dsh_update` query and removes that marker after load, so all tabs adopt the new frontend artifacts. A failed runner keeps the status endpoint, displays its error, and offers a reviewable GitHub issue draft containing bounded, automatically redacted logs; no issue is submitted without the user's GitHub confirmation. The sidebar trigger draws a blue dot while an update is available or being applied. Checks run automatically only for loopback clients whose host reports a git checkout and a restart-capable launcher; `host.checkUpdate`/`host.applyUpdate` are loopback-pinned on the wire.

The same section offers a separate, optional **AI-assisted updates** flow. The source selector defaults to the maintained `Mailo037/deepseek-harness` distribution and can instead target the official `deepseek-ai/deepseek-harness` upstream. Loading the selected Workspace's Host-reported model directory uses no AI credits; a model request starts only after the user chooses a review model and explicitly starts the visible session. Its durable prompt reports source versions and Git divergence, separates source changes, maintained-fork behavior, and local user customizations, and waits for approval before tracked-file edits. Approved work stays on an isolated `harness-sync/*` branch and worktree; the prompt preserves local changes, forbids changes to the active tree, and excludes push, merge, release, deployment, or restart. The regular fast-forward updater remains available without AI.

The shell ships no onboarding copy of its own — all text arrives from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order and mounts exactly one step at a time. Visible steps own their dialog chrome and app-root `inert` lifecycle; a mounted step still resolving private facts renders null, so nothing paints or blocks while it decides. The active registrant receives its id, `complete()`, and an `openSection(id)` callback; completing or skipping transfers ownership to the next entry. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source.

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

The Host half registers `ui-onboarding` in the user-settings seam. The welcome step contributed by `ui-settings-models` reads and writes its `welcomeNoticeVersion` through the existing public settings boundary; the shell itself remains policy-free.

## Model Experience

### AI-assisted update request

#### What the model sees

Choosing **Start AI update** appends one durable user-role message to the prepared visible session. The source role, local Workspace path, and selected repository fill the placeholders below. Merely opening Settings, changing the source, or loading the model directory sends nothing to a model.

##### Update-review message

```markdown
Review and safely integrate applicable changes from <source-role> into this locally customized Harness.

Local working tree: <workspace-path>
Selected update source: <repository-url>

First read the repository's AGENTS.md and every instruction file that applies to files you inspect or change. Then:

1. Inspect the local Git status, local commits, remotes, and version. Treat every pre-existing tracked or untracked change that is not proven to come from the selected source as user-owned customization; preserve it regardless of who authored it.
2. Discover the selected source's default branch and newest release tag. Fetch it into a namespaced remote-tracking ref without switching the active branch.
3. Report the local version, selected-source version, merge base, ahead/behind counts, and the important source changes since that base.
4. Build a three-part change ledger: selected-source changes, maintained fork/product changes, and local user customizations. Classify each source change as integrate, adapt around a customization, or intentionally leave out, including migrations, documentation, tests, and likely conflicts.
5. Present a concrete integration plan and wait for my explicit approval before editing tracked files.

After approval, work on an isolated harness-sync/* branch and worktree. Integrate deliberately instead of blindly merging the selected source. Reapply compatible source changes while retaining maintained-fork behavior and local user customizations; resolve every overlap explicitly and test both the updated product behavior and preserved customization. Never reset, rebase, merge, or clean the active working tree. Do not push, merge, release, deploy, or restart the app without a separate explicit request. Finish with the exact source changes integrated, customizations preserved, checks, remaining gaps, and a review path.
```

#### Token effect

Zero until the user starts the optional flow. Starting contributes the fixed review instructions plus the three short deployment values once as ordinary durable user history; subsequent analysis and tool results are data-dependent.

#### KV Cache effect

The new user message appends after the reusable prefix. Later turns can reuse the unchanged prefix and this message while the durable session history remains identical.

## Known Limitations and Deferred Work

- The General section has no built-in rows; each row appears only when its owning feature plugin is mounted.
