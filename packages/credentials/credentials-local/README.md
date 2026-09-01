# dsh-credentials-local

English | [中文](README.zh.md)

Local [credentials](../credentials/README.md) provider: four layers, one honest precedence, with user-scoped Windows encryption for provider-managed values.

| Layer | Source id | Writable | Wins |
|---|---|---|---|
| Inherited process environment | `env` | no | always |
| `$DSH_HOME/.credentials.yaml` document | `file` | yes (`set`/`unset`) | over both `.env` layers |
| `<invocation cwd>/.env` | `project-env` | not here | over the user `.env` |
| `$DSH_HOME/.env` | `user-env` | not here | otherwise |

The launching environment wins because a per-run override (`DEEPSEEK_API_KEY=… dsh`, a CI secret, a container `-e`) is operator intent for this run — and because it cannot be edited from inside, it must be *visibly* read-only: `describe()` reports `source: 'env', writable: false`, and `set`/`unset` reject instead of writing a change the reader would never see.

Everything below it loses to the managed store, so a key written by the Models page takes effect immediately even when an older key sits in a `.env`. Those two layers still resolve when nothing is stored, and `describe()` names them `project-env` or `user-env` with `writable: true` — storing a key replaces them as the effective source.

Under the product CLI, resolution reads the launcher's frozen [environment snapshot](../../util/launch-environment/README.md) rather than `process.env`: only the snapshot can say whether a value came from the launching shell or from a file. A composition the product CLI did not boot has the inherited environment as its only layer, which keeps embedders on the semantics they already had.

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | Credentials document location. |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness home used when `path` is omitted. |
| `watch` | `true` | Hot-publish external edits. |
| `debounceMs` | `100` | Watcher write-settle window. |
| `protection` | `platform` | `platform` encrypts the managed document with current-user DPAPI on Windows and uses owner-only plaintext elsewhere; `plain` explicitly keeps the YAML representation on every platform. |

## The document

The logical document is versioned YAML with one section per key space, and nothing else:

```yaml
version: 1

refs:
  DEEPSEEK_API_KEY: sk-…
  OPENAI_API_KEY: sk-…

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:                    # written verbatim; this provider does not interpret it
      type: oauth
      access: eyJhbGciOi…
      refresh: rft_9f8e7d…
      expires: 1786000000000
  llm-pi-ai/amazon-bedrock:
    kind: api-key               # environment values, no key: this route uses an AWS profile
    env:
      AWS_PROFILE: prod
  llm-pi-ai/amazon-bedrock-dev:
    kind: api-key               # neither: the owner confirmed the ambient credential chain
```

With the default `protection: platform`, Windows stores that complete YAML text inside a versioned JSON envelope whose `payload` is a current-user DPAPI blob. Neither credential names nor values remain readable in the file. The first Windows boot over an existing plaintext document validates it, performs any recognized inner-layout migration, and atomically replaces it with the protected envelope under the writer lock. A corrupt blob or one copied from another user or machine fails activation; it is never treated as an empty store. Other platforms retain the owner-only YAML representation, and `protection: plain` is an explicit Windows escape hatch for deployments that own encryption elsewhere.

The document holds credentials only, so every deviation is a rejection rather than a skipped entry — a silently ignored key would read as "the credential I stored has no effect". A non-mapping root, an unknown top-level key, a key that is not addressable in its space, a wrong-typed value, an empty string, an unknown record tag or field, a duplicate key, and malformed YAML all fail: loud at boot, and warn-and-keep-the-last-good-snapshot on a live reload.

A `grant` payload must survive a JSON round trip, enforced in both directions. YAML spells values JSON has none for — `.inf`, alias cycles — and an owner may hand over a `Date` or a `bigint`; either way the store refuses rather than saving something it could not read back exactly as written.

The pre-release layout was a flat mapping with no `version`. A boot that recognizes it exactly — addressable names over non-empty string scalars, no directives — upgrades the document in place under the writer lock: the original lines nest verbatim under `refs:`, so values, comments, and spellings survive byte for byte. Any other flat shape is refused by name, with the entry count and the one edit needed (`version: 1`, nest under `refs:`) — never read as an empty store, which would surface as an authentication failure on the first request instead of at load. A live reload never migrates: a flat document restored mid-run keeps the last good snapshot until the next boot.

Writes patch the decrypted parsed document rather than rebuilding it, so comments and the formatting of every untouched entry survive. A comment directly above an entry is that entry's annotation and is removed with it. Every write first re-reads and decrypts the document under the cross-process writer lock of [`dsh-atomic-write`](../../util/atomic-write/README.md), publishes anything it had not observed, then protects and atomically commits it with mode `0600` under an owner-only (`0700`) directory — so a concurrent writer or an external edit inside the watcher's debounce window is folded in rather than overwritten. An on-disk document that no longer decrypts or parses fails the write instead of overwriting content the provider could not understand.

Any string value round-trips, multi-line values included, so no entry is unwritable for want of a quoting style. An empty stored value is absent, per the seam rule — which is why an empty string in the document is rejected outright: `unset` removes a key, it does not blank it.

## Permissions

The provider creates the directory `0700` and creates or atomically replaces the document `0600`. It holds what it *reads* to that same bound: on POSIX a document carrying any group or other permission bit fails before its contents are parsed — at boot and on every reload — and the error names the `chmod 600` repair. Windows has no mode to inspect, so the check is skipped there rather than faked; current-user DPAPI protects the contents from another Windows account or a copied file on another machine.

## Hot reload

External edits publish `credentials/reference-updated` per changed reference after the snapshot is replaced **wholesale** — an entry deleted on disk never lingers in memory. Before Chokidar opens the target, the provider realpaths its deepest existing ancestor and restores any missing suffix; file access and diagnostics retain the configured path, while Windows cannot mix an 8.3 alias with long-form libuv events. The provider's own writes are recognized by stored content and publish exactly their one commit event. An unreadable, undecryptable, or invalid document at runtime keeps the last good snapshot and warns; an absent file is an empty store; the same failures at boot fail loud. Under Windows protection, a plaintext replacement is held as invalid until restart can validate and migrate it under the writer lock.

## Security boundary

On Windows, the default document contains only a DPAPI ciphertext bound to the current user and machine, so opening or copying the file does not reveal credential names or values. This is at-rest protection, **not isolation from every same-user process**: a process already running as that Windows user can invoke DPAPI, and tool processes run under that identity. On POSIX, `0600` under a `0700` directory stops other OS users but leaves plaintext readable to the same user. No surface hands the model a resolved document path or loads provider-managed values into the process environment — unlike `$DSH_HOME/.env`, the user's ordinary environment layer (see [app-boot's Harness-home layers](../../boot/app-boot/README.md#profiles)).

A deployment that must keep provider keys from arbitrary code already executing as its own account needs a separate least-privilege identity or credential broker; neither file permissions nor current-user DPAPI creates that process boundary.

## Model Experience

Indirectly, through the consuming LLM adapters: stored values authorize their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; credentials never enter a request prefix.

## Known Limitations and Deferred Work

- **Same-reference concurrent writes are last-write-wins** — the writer lock and the read-modify-write keep concurrent writers from dropping each other's entries, but two writers editing one reference still resolve to the later write; there is no revision check.
- **Current-user protection is Windows-only** — macOS and Linux retain the owner-only plaintext representation; a native keychain/Secret Service backend remains deferred.
- **DPAPI does not isolate same-user code** — see [Security boundary](#security-boundary): it prevents direct file disclosure and cross-user or cross-machine decryption, but code already executing as the protected Windows user can ask DPAPI to decrypt the blob.
- **Migration cannot erase earlier plaintext copies** — the atomic replacement protects the live document, but backups, filesystem snapshots, journal remnants, or diagnostic bundles created beforehand may still contain the old YAML; rotate any credential whose prior plaintext storage is considered exposed.
- **Environment changes are invisible** — the snapshot is frozen at launch, so a variable exported after startup reaches neither resolution nor `describe`; changing an environment-sourced credential takes a restart.
- **Atomic, not crash-durable** — inherited from `dsh-atomic-write`; the store re-reads on boot.
