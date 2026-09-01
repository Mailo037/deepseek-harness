# Agent Note: Android inline connection status and private endpoint details

Status: implemented

English | [中文](2026-08-30-android-inline-connection-status.zh.md)

## Problem

The Android shell and the embedded Web GUI each rendered a connection indicator. The Web GUI's indicator floated over conversation content because only the iframe knew the event-WebSocket state, while the Android bar knew only whether an HTTP probe reached the server. Connection details also exposed the full server origin as soon as the eye control opened, and a failed Tailscale path gave the same generic advice as a failed LAN path.

## Decision

The browser connection service sends a versioned `{ type: "dsh/client-connection-state", version: 1, state }` message after accepting the Android shell announcement and on every `connected`/`reconnecting` transition. The Android parent accepts a report only from the current iframe window and expected GUI origin. The message is informational and changes presentation only; request authentication remains the GUI access token.

The Android bar is the sole connection indicator. A fixed-height label viewport moves one 18 px step between `Remote` and `Reconnecting`, while both labels cross-fade on the Web theme's duration and easing tokens; reduced-motion preferences collapse those transitions. AppFrame keeps Android content visible and renders no duplicate status or full-screen reconnect overlay.

The eye control opens connection details with the origin blurred, non-selectable, and hidden from accessibility APIs until the user activates `Show`; `Hide` restores the cover. Labels use sentence case, and the Android chrome continues to consume the Web theme's semantic colors.

`EndpointSelection.isTailscaleEndpoint()` recognizes the Tailscale IPv4, IPv6, and `*.ts.net` forms. The native bridge checks Android `NetworkCapabilities.TRANSPORT_VPN`. A slow loader and the unreachable screen use those facts to distinguish a disabled Tailscale connection from general reachability failure without treating VPN state as authority.

## Testing

Connection and layout component specs pin the parent state reports, Android overlay suppression, and ordinary-browser overlay behavior. Android unit specs pin the versioned message parser and Tailscale address classification; TypeScript typecheck and the production Vite build cover the app. The device smoke GUI reports its connection state, asserts the inline status, and proves that the origin starts covered before `Show`. Kotlin compilation covers the native VPN query. A mobile Chromium pass verifies the 18 px elevator transform, theme easing, blurred address, reveal control, and Tailscale guidance.

## Alternatives considered

**Derive the bar only from HTTP probes.** Rejected because the document may still answer while both event WebSockets are reconnecting; the displayed state would disagree with the usable UI.

**Keep the Web GUI's floating indicator and remove the Android bar state.** Rejected because it obscures content and duplicates chrome the parent already owns.

**Infer Tailscale from any unreachable remote address.** Rejected because LAN and public deployments need different guidance. Address classification plus Android's VPN transport produces a specific hint without claiming that the VPN authenticates the user.

**Reveal the endpoint whenever details open.** Rejected because the endpoint is diagnostic information that can appear in screenshots or shoulder-surfing; one explicit reveal preserves access without making exposure the default.

## Consequences

Android has one stable connection affordance whose state matches the embedded carrier, and recovery no longer places a control over conversation content. Endpoint disclosure requires an extra tap, and Tailscale failures give an actionable path. The parent/iframe presentation protocol gains one versioned message, the native plugin gains a read-only network-state method, and real-device behavior still depends on Android exposing Tailscale as `TRANSPORT_VPN`.
