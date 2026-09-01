# Setting up remote control from an Android phone

English | [中文](remote-android-app.zh.md)

A step-by-step guide to controlling the Harness Web GUI from an Android phone
via the [Harness Remote app](../../apps/android/README.md). The phone becomes a
remote client of the PC that runs `dsh --profile web`; the app is a thin shell
(QR pairing + WebView + notification service) and never bundles the GUI.

Prerequisites: a PC running the Harness checkout with the remote plane mounted
(it is part of the `web` profile since the [remote device plane Agent Note](../../.agents/notes/implemented/architecture/2026-09-02-remote-device-plane.md)),
a phone on the same network (or a tunnel), and the app APK built from
[`apps/android`](../../apps/android/README.md).

## 1. Start the web profile with remote pairing

On the PC:

```sh
dsh --profile web
```

Open the GUI (`http://127.0.0.1:3080`), then **Settings → 远程设备 / Remote
devices → 生成配对码 / Generate pairing code**. The card shows a QR code and the
expiry time; the JSON payload text stays masked behind a Show/Hide toggle (it
remains copyable while masked).

For phone access over the LAN, the browser API needs the PC's LAN address in
the trust fence — pass it on startup:

```sh
dsh --profile web --trusted-host 192.168.1.5:3080
```

## 2. Pair the phone

In the app: **Scan QR Code**. The app tries the endpoints from the QR payload
in order (auto-detected LAN addresses first, then the configured extras),
performs the `pair` handshake over the device channel
(`ws://<pc>/remote/device`), stores the device secret, and opens the GUI in a
full-screen iframe.

Manual fallback: enter the server URL (`192.168.1.5:3080`) and the pairing
token in the app's manual fields.

## 3. What happens next

- The **foreground notification service** connects to the device channel with
  the stored secret and posts an Android notification whenever the host pushes
  a `turn-error` or `turn-completed` frame (a turn that ended in an error, or a
  completed turn). It reconnects with backoff and keeps working while the app
  is backgrounded.
- The **GUI iframe** loads the current web GUI fresh from the PC on every
  connect — GUI improvements on the PC never require an app update.
- If the PC is unreachable, the app shows the connection-lost screen with a
  retry button; if the phone loses network, it shows the offline banner.

## 4. Revoke a device

On the PC, **Settings → Remote devices → 断开连接 / Disconnect** next to the
phone. The host terminates the socket immediately, deletes the device record,
and invalidates its secret — the phone cannot reconnect until it scans a new
pairing code.

## Remote access with Tailscale

The steps above reach the PC from the home Wi-Fi only. With [Tailscale](https://tailscale.com) on both devices, the phone also reaches the GUI and the notification channel over mobile data, on any network, through an encrypted tailnet — no router port forwarding, no re-pairing on network switches (the app stores every endpoint and falls back automatically).

**HTTP over the tailnet, not `tailscale serve`.** All endpoints use plain `http://` (Tailscale IP or MagicDNS name) and `ws://` for the channel. `tailscale serve` is a reverse proxy to `127.0.0.1`, so the Harness would see the access as loopback traffic and the GUI access-token guard would be silently bypassed. Direct HTTP over the tailnet keeps the guard active: Tailscale addresses (`100.x.y.z`) are not loopback, so `isLoopbackRequest` still requires the access token.

### Setup

1. Install Tailscale on the PC and log in; install it on the Android device and log in with the same tailnet.
2. **Guided path:** in the GUI, open Settings → Remote devices → **Set up with Tailscale**. The section queues the setup task into the current session, and the agent runs the [dsh-tailscale-remote-setup skill](../../.agents/skills/dsh-tailscale-remote-setup/SKILL.md): it checks the PC's Tailscale state, merges the rows below into the user profile patch, verifies composition and reachability, and then guides the pairing and phone steps.
3. **Manual path:** merge the three owned rows into `$DSH_HOME/profiles/web/cordis.patch.yml` (read the file first; replace or insert only these rows; each row restates its whole `config` — a patch never deep-merges), with `<TAILSCALE_HOST>` from `tailscale ip -4`:

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

   The profile patch is the user-owned layer: it applies after every bundle layer in checkouts and built installs alike, and the running server picks changes up live through the patch watcher — no restart. Verify the composition with `dsh --profile web --dump-config` (a checkout runs it through `pnpm dsh`), then request `http://<TAILSCALE_HOST>:<HARNESS_PORT>/` over the tailnet address (200/4xx proves the path; the access-token guard still applies).
4. Launch the server plain from now on — `dsh --profile web` without `--host`/`--trusted-host`. Launcher flag layers apply above user patches, so those flags would override the patch's bind and fence rows; `--no-open` and `--pairing-qr` stay harmless.
5. Regenerate the pairing code (Settings → Remote devices → Generate pairing code) and scan it in the app. The app stores the full endpoint list and is reachable over both networks.
6. Test Wi-Fi and mobile data, the switch between them, airplane mode on/off, and a few minutes of locked screen: the WebSocket and the GUI recover on their own; no re-pairing is needed.

### ACL / grant rule (Tailscale admin console → Access Controls)

```json
{
  "grants": [
    {
      "src": ["<TAILSCALE_ACCOUNT>"],
      "dst": ["tag:harness-pc"],
      "ip": ["tcp:<HARNESS_PORT>"]
    }
  ],
  "tagOwners": { "tag:harness-pc": ["<TAILSCALE_ACCOUNT>"] }
}
```

Tag the PC once (`tailscale set --tag=tag:harness-pc`). The rule lets only your own account reach only the Harness port on the tagged PC.

### Battery optimization

Disable battery optimization for **Tailscale** ("Unrestricted") and for the Harness Remote app ("Never sleep"/"Always allow") — otherwise Doze and deep sleep drop the tailnet connection and the device WebSocket for minutes at a time. The app does not change system settings itself.

### Security model

Two independent layers: tailnet network access (the ACL above) and the Harness access token, which stays mandatory for Tailscale connections. Only your own devices can reach only the Harness port.
