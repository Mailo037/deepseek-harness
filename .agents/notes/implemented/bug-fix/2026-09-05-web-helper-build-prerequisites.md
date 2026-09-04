# Agent Note: Web helper build prerequisites

Status: implemented

English | [中文](2026-09-05-web-helper-build-prerequisites.zh.md)

## Problem

The source web host imports generated Typert contributors and serves client plugin bundles. The frontend build also imports workspace libraries from `lib/`. Building only the frontend fails on an unbuilt checkout and can serve stale plugins after source changes.

## Decision

The [development helper](../../../../scripts/dsh-dev.mjs) runs the repository's complete `build` before starting the web host. That build owns host generation, client compilation and bundling, frontend compilation, and the client build record. Build failures prevent startup. `--full` remains accepted and selects the same build. Direct `pnpm dsh web` continues to require prepared artifacts.

## Alternatives considered

**Build only when selected files are missing.** Presence cannot establish freshness or completeness across dynamically loaded plugins. Reusing the complete build avoids a second dependency inventory in the helper.

**Require a manual build or `--full`.** This leaves the default build-and-serve command unable to prepare its own prerequisites.

## Consequences

Each helper invocation spends time building the harness. Users with prepared artifacts can start the host directly. Subprocess regression tests cover default and explicit `--full` startup, forwarded host flags, and stopping after a failed build. This changes repository tooling only; model requests, protocol output, and application transcripts are unchanged.
