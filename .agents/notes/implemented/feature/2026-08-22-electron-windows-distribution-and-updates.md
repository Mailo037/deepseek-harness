# Agent Note: Electron Windows distribution and installed-app updates

Status: implemented

English | [中文](2026-08-22-electron-windows-distribution-and-updates.zh.md)

## Problem

The Electron app ran from a checkout but did not produce a Windows installer, carry a release identity, or give an installed application a verified update path. The About-page Git updater cannot fill that role because a packaged application has no working tree to fast-forward.

## Decision

`dsh-electron` uses electron-builder to create an x64 NSIS installer with its emitted main tree, configuration, runtime dependencies, bundled web frontend, application metadata, and Windows icon. The normal package command always passes `--publish never`; the protected tag-bound workflow is the only path that signs and uploads release artifacts.

electron-builder obtains Windows signing credentials only from `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` in the protected workflow environment. Source configuration contains neither a certificate path nor a credential, and Windows update downloads retain Authenticode verification.

Installed applications use `electron-updater` against the configured GitHub release. It checks at startup and every six hours, reports checking/download/error states through native Electron UI, and requires one confirmation to download and a second confirmation to restart and install. It disables automatic download and install-on-quit. The checkout updater remains the host/API implementation for a Git working tree.

## Alternatives considered

**Reuse the checkout updater for installed applications.** It cannot update a packaged application safely because it operates on Git history and a fast-forwardable working tree.

**Download and install updates automatically.** Explicit download and restart choices keep agent work, unsaved user decisions, and application shutdown under user control.

**Keep signing fields in the builder configuration.** Environment-only credentials prevent certificate locations and passwords from entering source, logs, or a published package.

## Testing

The updater unit tests cover periodic checks, the two approval points, progress, and errors. Distribution tests pin the NSIS target, icon, shipped resources, verification setting, release provider, and absence of signing material. The package smoke starts the unpacked Electron product with updater traffic disabled, waits for a readiness file written after the real window loads, and observes clean shutdown. A file is required because Windows GUI executables do not reliably forward standard output. The plain-Node host smoke requires built runtime dependencies and is skipped in source-only test lanes. Electron's emitted tree excludes source and declaration maps so npm tarballs satisfy the release archive policy.

## Consequences

Windows has a reproducible unsigned package and a protected signed-release path without changing checkout updates. A real update-channel proof still requires a trusted certificate and a published signed release, which this repository change deliberately does not create.
