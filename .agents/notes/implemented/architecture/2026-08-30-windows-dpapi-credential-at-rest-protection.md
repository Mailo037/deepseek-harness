# Agent Note: Windows DPAPI credential at-rest protection

Status: implemented

English | [中文](2026-08-30-windows-dpapi-credential-at-rest-protection.zh.md)

## Problem

`credentials-local` kept provider-managed API keys and authorization grants as plaintext YAML. Owner-only permissions prevented another OS account from opening the document on POSIX, but Windows could not verify equivalent ACLs and any backup, diagnostic bundle, or direct file read exposed both credential names and values. Base64 would only change their representation and provide no confidentiality or integrity.

## Decision

`credentials-local` defaults `protection` to `platform`. On Windows this resolves to current-user DPAPI: the provider serializes the complete logical YAML document, protects those bytes through the maintained prebuilt `@primno/dpapi` N-API binding, and writes a strict versioned JSON envelope containing only the protection method and Base64 transport encoding of the opaque DPAPI blob. The Base64 layer transports ciphertext; DPAPI supplies confidentiality and integrity and binds decryption to the same Windows user on the same machine. Other platforms retain the owner-only plaintext representation until their native stores are implemented; `protection: plain` is an explicit deployment override.

The first Windows activation over plaintext validates the inner document under the existing cross-process writer lock, performs the recognized pre-release layout migration when required, protects the result, and atomically replaces the file. A malformed envelope, corrupt ciphertext, foreign-user or foreign-machine blob, unsupported method, or unsupported version fails activation rather than becoming an empty store. A running protected provider refuses a plaintext replacement; restart is the only migration point, so a watcher event cannot silently downgrade storage.

The decrypted YAML remains the comment-preserving edit model in memory. Every write re-reads and decrypts the current file under the existing lock, patches one reference or record, protects the complete result, and atomically commits it. The raw stored envelope is tracked separately for watcher self-write suppression. Existing precedence, per-operation resolution, events, record mutation, and `0600`/`0700` behavior remain unchanged.

This is at-rest protection, not a process-isolation claim. Code already running as the same Windows user can call DPAPI, including an agent tool process with arbitrary native execution. Keeping secrets from arbitrary same-account code requires a separate least-privilege identity or credential broker.

## Verification

The credentials-local package suite covers plaintext migration, absence of credential names and values from the stored envelope, protected restart, corrupt-ciphertext rejection, runtime plaintext-downgrade refusal, explicit-plaintext refusal of an existing protected document, the platform decision, and all pre-existing storage behavior. The Windows tests execute real DPAPI; non-Windows hosts retain the plaintext unit path.

## Alternatives considered

**Base64 or reversible application encoding** — rejected because the decoder and encoded value are available together; it prevents neither disclosure nor tampering.

**A hand-written Koffi call table for `CryptProtectData`** — rejected after the focused implementation produced intermittent invalid blobs under the repository's forked test load. The maintained prebuilt N-API package removes owned FFI layout and memory-management code while keeping the Windows API and current-user scope explicit.

**Windows Credential Manager as the only store** — rejected for this change because the credential service stores one atomic document spanning references and opaque authorization records, with cross-process read-modify-write and enumeration semantics. Splitting every field into independent OS entries would require a second durable index and a transaction design; it would not create isolation from arbitrary same-user code.

**Failing `platform` on macOS and Linux** — rejected because it would make an existing local provider unusable on supported platforms. Their current owner-only file behavior stays explicit as a limitation rather than being mislabeled as encrypted.

## Consequences

Opening or copying the default Windows credential document no longer reveals provider names, API keys, refresh tokens, or authorization payloads, and tampering fails authentication during decryption. The document is intentionally bound to one Windows user and machine, so moving it to another account or host is not a credential migration mechanism and an administrative password reset can make it unrecoverable. Replacing the live plaintext file cannot erase prior backups, snapshots, journal remnants, or diagnostic copies; operators who treat earlier plaintext storage as exposure must rotate those credentials. The native prebuilt dependency joins the published runtime closure and its no-op install script is explicitly allowed by the workspace supply-chain policy. macOS Keychain, Linux Secret Service, and isolation from same-account arbitrary code remain outside this decision.
