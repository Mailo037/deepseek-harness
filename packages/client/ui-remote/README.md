# @deepseek-ai/dsh-client-ui-remote

Web-GUI Settings section for remote devices: hand the guided Tailscale setup to the session agent, generate a one-time pairing QR code, list paired devices with live connection status, and revoke a device instantly (socket kill + persistent record removal, no undo).

The section drives the host `device` Remote namespace (`@deepseek-ai/dsh-host-remote`): `pairingCreate`, `devicesList`, `devicesRevoke`, `accessTokenGet`. The Tailscale group queues the localized setup task (the [dsh-tailscale-remote-setup skill](../../../.agents/skills/dsh-tailscale-remote-setup/SKILL.md) procedure) into the current session through the sessions face; the modal closes onto the conversation where the agent runs it.

## Registration

The browser half registers one `settings.section` entry (`id: 'remote'`, `order: 15`) with the “Remote devices” label, localized in `zh`/`en` under the `settings.remote` namespace, plus the fs-deny entry (`id: 'fs-deny'`). The section lays its contents over three tabs — pairing code (with the access token), paired devices, and the Tailscale setup — following the Plugins section's tablist pattern; panels stay mounted and hide, so pairing state and the device snapshot survive switching.

## Model Experience

### Tailscale setup task (user message)

#### What the model sees

One localized `user/message` queued into the current session when the user clicks the setup action: a task prompt that names the `dsh-tailscale-remote-setup` skill and its fixed points (plain `http` over the tailnet, never `tailscale serve`), then requests the environment checks, the profile-patch merge, the verification, and the phone steps. The exact text is the `tailscalePrompt` key of this package's `settings.remote` locale dictionaries — localized product copy, not stable system-prompt prose. No tool schema and no system-prompt section are registered.

#### Token effect

Fixed per click: one user turn carrying the task text, a few hundred tokens; the agent's subsequent setup work is ordinary tool-driven turns owned by the agent loop.

#### KV Cache effect

Append-only: the task text lands once as an ordinary user turn and stays in the transcript like any user message. Clicking the action again appends another such turn; nothing this package owns replaces an earlier request prefix or starts an independent model request.

## Known Limitations and Deferred Work

- The QR code is generated client-side from the host pairing payload (`qrcode` package); the payload text and the GUI access token are masked behind explicit show/hide toggles and stay copyable while masked.
- The device list is a point-in-time snapshot (loaded on mount and after each revoke); live push of device state changes to the section is future work.
- The Tailscale handoff targets the current session and refuses a subagent route; it cannot create a dedicated setup session (no sanctioned cross-plugin session-create route today).
- The handoff cannot confirm completion: after a host restart (the skill's fallback path) the session resumes only when the user returns to it.
