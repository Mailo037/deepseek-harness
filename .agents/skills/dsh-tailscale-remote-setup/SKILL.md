---
name: dsh-tailscale-remote-setup
description: Use when the user wants to reach the Harness Web GUI and its Android notification channel from their phone outside the home network via Tailscale — configure the web profile bind, trusted-host fence, and remote plugin endpoints, generate a pairing code, guide the phone-side steps the agent cannot perform, and diagnose endpoint, ACL, or access-token failures.
---

# Tailscale Remote Setup

Set up phone access to the Harness Web GUI over a private Tailscale tailnet, for home Wi-Fi and mobile data alike. The host-side steps are yours to execute; the phone-side steps are the user's — state them as concrete instructions, never as questions. This skill is a procedure, not a design document; the rationale lives in the [Tailscale cookbook section](../../../docs/cookbook/remote-android-app.md#remote-access-with-tailscale) and the [remote device plane note](../../../.agents/notes/implemented/architecture/2026-08-28-tailscale-remote-device.md).

All endpoints are plain `http://<TAILSCALE_HOST>:<HARNESS_PORT>` origins — never `tailscale serve`, TLS, or MagicDNS requirements. `tailscale serve` proxies to `127.0.0.1`, which would make the Harness see the access as loopback and silently bypass the GUI access-token guard. Do not propose or configure it.

## Placeholders

Resolve these from the environment; never invent them. `<TAILSCALE_HOST>` is the PC's Tailscale IPv4 (`100.x.y.z`, `tailscale ip -4`) or its MagicDNS name. `<HARNESS_PORT>` is the live port — read it from `DSH_WEB_URL` in a web-session shell command (`http://127.0.0.1:<port>`); never assume `3080`. `<TAILSCALE_ACCOUNT>` is the user's tailnet identity from `tailscale status`. `<PROFILE_PATCH>` is `$DSH_HOME/profiles/web/cordis.patch.yml` (the Harness home resolves through `$DSH_HOME`, else `~/.dsh`).

## Workflow

1. Check the environment: `tailscale version` (installed on the PC?), `tailscale status` (logged in, tailnet reachable). If Tailscale is missing or logged out, stop and hand the user the install/login step; resume when they confirm.
2. Resolve `<TAILSCALE_HOST>` from `tailscale ip -4` (or the MagicDNS name from `tailscale status`) and `<HARNESS_PORT>` from `DSH_WEB_URL`. Report both and the `<TAILSCALE_ACCOUNT>` to the user.
3. Merge the three owned rows into `<PROFILE_PATCH>`: read the existing file first (create it from the shipped template comment if absent), replace or insert ONLY the `webserver`, `web-runtime`, and `remote` rows below, and preserve every other row and comment verbatim. Each owned row restates its whole `config`; a patch replaces the targeted row's whole config, it never deep-merges.

   ```yaml
   - id: webserver
     config:
       host: '0.0.0.0'
       port: !!js ctx.webStartup.port ?? 3080

   - id: web-runtime
     config:
       openBrowser: !!js ctx.webStartup.openBrowser
       printUrl: true
       surfaceContext: true
       trustedHosts: !!js >-
         [...ctx.webStartup.trustedHosts, '<TAILSCALE_HOST>']

   - id: remote
     config:
       endpoints: !!js >-
         ['http://<TAILSCALE_HOST>:' + (ctx.webStartup.port ?? 3080)]
       pairingTtlSeconds: 300
       notifyOnError: true
       notifyOnCompleted: true
       printPairingQr: !!js ctx.webStartup.printPairingQr ?? false
   ```

   Never write these rows into a repository file: the profile patch is the user-owned layer that survives pulls in checkouts and updates in built installs alike.
4. Verify the composition offline before trusting the live reload: `dsh --profile web --dump-config` must compose without warnings and show the three rows with the resolved values (a checkout runs it through `pnpm dsh`). If the dump reports a parse error or a skipped patch, fix `<PROFILE_PATCH>` before continuing.
5. The running server picks the patch up live through the user patch watcher — no restart. Verify reachability over the tailnet: request `http://<TAILSCALE_HOST>:<HARNESS_PORT>/` with curl or PowerShell `Invoke-WebRequest`; a 200/4xx proves the path (the access-token guard still applies to GUI routes). If the live server did not pick the patch up while the dump composes cleanly, restart the host once — call the `rebuild_harness` tool on a checkout host, otherwise ask the user to restart `dsh --profile web`.
6. Tell the user to launch the server plain from now on — `dsh --profile web` without `--host`/`--trusted-host` — because launcher flag layers apply above user patches and would override the patch's bind and fence rows. `--no-open` and `--pairing-qr` stay harmless.
7. Instruct the phone steps (user actions): install Tailscale, log in to the same tailnet, disable battery optimization for Tailscale ("Unrestricted") and for the Harness Remote app, open the GUI → Settings → Remote devices → Generate pairing code, scan it in the app. For tailnet-wide least privilege, add the ACL/grant rule from the cookbook (admin console) and tag the PC once (`tailscale set --tag=tag:harness-pc`).
8. Verify pairing: the device appears under Settings → Remote devices with a live connection status. Ask the user to toggle Wi-Fi off (mobile data on) and confirm the GUI recovers without a new pairing code; the status bar shows the origin the app adopted.

## Failure diagnosis

- The dump reports a patch row as not found: the `webserver`, `web-runtime`, and `remote` row ids must exist in the composed `dsh-web-app` bundle tree; a typo'd id warns and is skipped, leaving the old values live.
- GUI unreachable over `<TAILSCALE_HOST>` but reachable over LAN: the webserver row did not apply (use step 5's restart fallback), or the tailnet ACL blocks the port. The ACL must allow `src: [<TAILSCALE_ACCOUNT>]` → `dst: [tag:harness-pc]` → `ip: ["tcp:<HARNESS_PORT>"]` with the tag owned by `<TAILSCALE_ACCOUNT>`; deny-by-default, never an empty ACL.
- API calls fail from the app's iframe while the GUI loads: `<TAILSCALE_HOST>` is missing from the fence — check in the dump that the `web-runtime` row's `trustedHosts` contains it, and that the server was not started with `--trusted-host` flags, which outrank user patches.
- The access-token guard suddenly stops applying: something introduced `tailscale serve` or another loopback proxy. Remove it; the guard requires a non-loopback peer address, which Tailscale IPs (`100.x.y.z`) satisfy.
- The app shows "PC not reachable" on both endpoints: the host process is down, or the phone's Tailscale VPN is off. The app sweeps its stored endpoints automatically; no host-side action is needed for endpoint failover.
- Notification stops while the screen is locked: battery optimization is active for Tailscale or the app. The fix is in the OS settings; the agent cannot change it.

## Guardrails

Never log, echo, or persist pairing tokens, device secrets, or access tokens. Never weaken the trust fence to make a connection work (no `--trusted-host *`, no disabling the token guard). Never edit host code in `packages/host/remote` or the client connection packages for this setup — the only host-side change is the user's profile patch. Scope: this skill covers Tailscale remote access only; ordinary LAN setup and pairing belong to the [remote cookbook](../../../docs/cookbook/remote-android-app.md).
