# Agent Note: Release package validation and desktop preset discovery

Status: implemented

English | [中文](2026-09-02-release-package-validation.zh.md)

## Problem

The remote package omitted the registry helper imported by its published runtime. Electron resolved shipped presets relative to its source module, which points to the wrong directory after compilation into `lib/types`. Repository dependency checks also missed device-test entrypoints and treated configuration-loaded plugins as unused.

## Decision

The remote manifest publishes `lib/registry-*.js`. Electron resolves `config/agent-presets` from its self-referenced package manifest in both source and installed layouts. Its plain-Node built-host smoke reads the real preset roster before reporting readiness.

Knip includes Android device scripts, the standalone native-channel protocol declarations, Electron packaging declarations, and Firecrawl e2e tests as entrypoints. Electron uses the same scoped dependency exemption as the CLI because Cordis configuration loads its plugins; the Cordis-config and runtime-closure gates still validate those dependencies. Android retains `@capacitor/app`, registered by its native Capacitor manifest. Unused library dependencies and root desktop commands targeting nonexistent Firebase scripts and a nonexistent `desktop/` directory are removed; the app-owned Electron commands remain authoritative.

The vendor-rescope verifier retains the Electron `cordis` preset identifier and uses current exact-edit anchors without changing vendored source.

The shell-command package retains `zod` for its generated Typert runtime even though its authored source does not import it. Built-host startup verifies that generated dependency.

## Alternatives considered

Removing configuration-loaded dependencies would break packaged startup. Resolving presets from the current working directory would make installation behavior depend on how the executable was launched. Broadly disabling dependency or publication checks would conceal missing runtime files.

## Validation

The built package invariant and runtime-closure gates check the remote publication. The Electron host smoke requires the shipped `code`, `cordis`, `minimal`, and `standard` presets, then verifies the served web shell and clean shutdown. Knip and the vendor-rescope gate check their complete source inventories.

## Consequences

Packaged hosts retain their preset roster and remote registry implementation. Building a Windows Electron distribution still requires the native compilation toolchain; an Android APK build does not validate that desktop toolchain.
