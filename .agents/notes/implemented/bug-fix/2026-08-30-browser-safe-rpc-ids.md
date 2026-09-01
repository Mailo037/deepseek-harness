# Agent Note: Browser-safe RPC correlation IDs

Status: implemented

English | [中文](2026-08-30-browser-safe-rpc-ids.zh.md)

## Problem

The browser API carrier minted rpcIds with `crypto.randomUUID()`. Browsers expose that method only in secure contexts, while the supported remote GUI can use plain HTTP on a trusted LAN or Tailscale address. A synchronous mint failure aborted a new connection generation after its event sockets were constructed but before their handshakes reached the Host, leaving the GUI in its reconnect state while the separate native device channel continued to deliver notifications.

## Decision

The API carrier owns one RFC 4122 version 4 generator backed by `crypto.getRandomValues()`, which browsers expose on non-secure origins. `AbstractApiClient`, the generic connection RPC caller, and client fixtures share that generator. A runtime without Web Crypto fails before dispatch; the carrier never falls back to `Math.random()` or another weaker source.

The remote browser e2e resolves a non-loopback `.test` hostname to the loopback test server and asserts that its page is not a secure context. The ordinary connection and reload path therefore exercises the browser environment that exposed the defect. Package coverage also removes `randomUUID` from the test crypto object and carries a real `host.describe` request through the fetch handler.

## Alternatives considered

**Require HTTPS for every remote GUI.** Rejected because trusted LAN and Tailscale HTTP access is already a supported deployment, and request correlation does not require a secure-context-only API.

**Use an incrementing or pseudo-random identifier.** Rejected because rpcIds cross concurrent streams and diagnostic taps; Web Crypto supplies sufficient entropy without weakening the existing uniqueness expectation.

**Catch the mint failure in the reconnect controller.** Rejected because retries cannot make `randomUUID()` appear on the same origin. The carrier must use an API available in every supported browser context.

## Consequences

Plain-HTTP remote browsers can complete the readiness RPC and retain both event streams. Secure-context, Electron, and in-process callers use the same UUID format. The change has no transcript or model-visible output, so no snapshot changes; the assembled browser e2e owns the user-visible reconnect regression.
