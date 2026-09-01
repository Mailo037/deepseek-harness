# Agent Note: Guided Tailscale setup from the Remote devices page

Status: implemented

English | [中文](2026-08-29-guided-tailscale-remote-setup.zh.md)

## Problem

Remote phone access over Tailscale required hand-editing configuration files per the cookbook: a bind row here, a trust-fence entry there, an endpoint in the remote plugin. The setups people actually ran were incomplete — a plain `0.0.0.0` bind without the fence entry or the pairing endpoint — and fragile because the values lived in launch flags or a tracked repository file. A user who did not author the procedure had no path that produced a complete, durable setup.

## Decision

**The Remote devices settings page hands the setup to the session agent.** The `ui-remote` section gains a Tailscale group whose action queues the localized setup task into the current session through the sessions face (`binding(current).session.prompt(..., 'queue')`), closes the settings modal onto the always-mounted conversation (the `settings.section` owner `close` prop), and refuses without a usable ordinary session (none current, or the current route is a subagent catalog). The prompt names the [dsh-tailscale-remote-setup skill](../../../skills/dsh-tailscale-remote-setup/SKILL.md) and its fixed points: plain `http` over the tailnet, never `tailscale serve`.

**The procedure writes the user's profile patch, not repository files.** The skill merges three rows into `$DSH_HOME/profiles/web/cordis.patch.yml` — the `webserver` bind row, the `web-runtime` trust-fence row, and the `remote` endpoints row — preserving the user's other rows and comments; each owned row restates its whole config because a patch never deep-merges. The running server recomposes the user patch layer live (`watchUserPatches`), so setup needs no restart; `dsh --profile web --dump-config` verifies the composition offline and a tailnet request verifies reachability. A host restart stays the fallback for a host that missed the live reload.

**Launch flags defer to the patch.** Launcher flag layers apply above user patches, so the procedure pins the plain `dsh --profile web` launch: `--host`/`--trusted-host` would override the patch rows; `--no-open`/`--pairing-qr` stay harmless.

## Alternatives considered

- **A host Remote method performing the setup programmatically.** Lost: the flow is diagnosis plus merge plus verification across environment facts (Tailscale state, live port, existing patch content) that the agent's tools already handle; a wire method would duplicate filesystem and policy semantics and extend the device wire contract for a one-shot setup.
- **Keeping the checkout bundle patch (`packages/bundle/web-app/cordis.patch.yml`) as the write target.** Lost: checkout-only and tracked, so the setup dirties the tree and dies on pull; the profile patch is the user-owned layer for checkouts and built installs alike.
- **A settings-side wizard that performs the steps itself.** Lost: login, ACL, and pairing need user interaction or host tools a browser client cannot reach; the agent session already renders confirmations, questions, and progress in one place.

## Consequences

Bought: one click to a complete, durable setup for any user; live reconfiguration without a restart; the trust fence stays explicit — the Tailscale host is an added trusted authority, never a weakened guard. Cost: the handoff needs a current ordinary session and cannot confirm completion — after the restart fallback the session resumes only when the user returns; the agent edits YAML in a user file, so the dump verification is the guard against malformed merges. The skill and the [cookbook](../../../../docs/cookbook/remote-android-app.md#remote-access-with-tailscale) share the profile-patch procedure and move together.

## Related

- [Tailscale endpoints for the remote device plane](../architecture/2026-08-28-tailscale-remote-device.md) — the multi-endpoint app behavior this setup feeds.
- [Remote device plane](../architecture/2026-09-02-remote-device-plane.md) — the host plane this setup configures.

## Testing

Component specs cover the handoff outcomes (success closes settings; no-session, rejection, and thrown handoff stay with a hint; the in-flight state) and the section's pairing, device, and token states; the registration spec pins the inject list and that the queued prompt names the skill. `DSH_SNAPSHOT=replay pnpm run test:web` replays the assembled GUI. The live procedure ran end to end on the authoring machine: patch merge, offline dump, live reload without restart, tailnet reachability, and a pairing payload led by the Tailscale origin.
