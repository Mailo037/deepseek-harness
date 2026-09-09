# `@deepseek-ai/dsh-tool-session-start`

English | [中文](README.zh.md)

Model-facing `create_session` tool: starts a new, empty chat on this host inside the calling chat's project. The tool derives the target from the caller — the registered workspace accounting the calling session, else its recorded cwd — reuses the calling agent's preset composition, and asks the approval seam before anything is created, so the user confirms every chat birth. Creation itself goes through the host gateway's `session.create` path, so the browser learns the new chat through the same `host/session-added` stream as any other session and no second creation path exists.

A subagent session can never call the tool: only a top-level chat may start another chat. Two approved calls serialize in call order. The tool never sends a first message to the new chat and never navigates the user's view; it reports the stable identity fields (session id, cwd, preset, workspace source) for the model to relay.

## Model Experience

### Tool schemas

#### What the model sees

The generated [`create_session` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-start) while the tool is visible.

#### Token effect

Fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while tool definitions and visibility are unchanged.

### Create result

#### What the model sees

One result block per call. It states the created chat's id and workspace path, names the preset the chat runs when one was composed, and instructs the model to tell the user the chat is ready in the sidebar without claiming the user is viewing it.

#### Token effect

The block stays in parent history until compaction; its length is constant per call.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing entries.

## Known Limitations and Deferred Work

- **Web-bundle row only** — the shipped web-app patch mounts the tool; a CLI/TUI profile that wants it composes the row itself. The tool requires `ctx.apiProxy`, so a deployment without the gateway fails the call at load.
- **Approval is mandatory** — a deployment without an approval service refuses the call instead of degrading to silent creation.
- **No first-message delivery** — the gateway's create path has no prompt parameter; the user opens the chat and writes the first message.
