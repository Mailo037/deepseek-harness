# @deepseek-ai/dsh-tool-session-query

English | [中文](README.zh.md)

Workspace-authorized model tools over `ctx.sessionQuery`. The opt-in package depends only on the unified interface and registers `session_search`, `session_event_search`, `session_summary`, `session_trace`, `session_event_trace`, and `session_event_read`; shipped host compositions do not mount it by default.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `maxSearchResults` | `100` | Maximum authorized non-self hits collected across internal provider pages |
| `searchTimeoutMs` | `30000` | Cooperative deadline attached to both full-text search tools |
| `maxResultBytes` | `65536` | UTF-8 byte limit for every redacted model-visible result |
| `summaryMaxItems` | `12` | Maximum evidence entries in each repeated `session_summary` section |
| `summaryMaxEvidenceCharacters` | `400` | Maximum character excerpt for one `session_summary` text evidence entry |

The caller comes exclusively from `ToolExecution.exec.agent`. Cross-session access requires exact equality between the target and caller session `cwd` values; a caller without `cwd` can inspect only itself. Search never exposes provider cursors, offsets, page sizes, or a model-controlled limit. Because one search consumes generation-bound provider cursors internally, both search tools execute exclusively with sibling tool calls; the four exact summary/trace/read tools opt into parallel execution. Every exact executor passes its unchanged execution signal through authorization and the service read, so cancellation waits for cooperative persistence cleanup and retains the signal's exact reason. Timestamps at the tool boundary require an explicit `Z` or numeric offset and become inclusive epoch-millisecond filters.

`session_search` always omits the caller session. Requested parent ids are deduplicated and checked against caller-workspace authority before FTS; only authorized ids reach the provider, while missing and cross-workspace guesses behave identically and the root marker remains independently ORed. A current-session `session_event_search` stops immediately before the step that invoked it, so the active assistant output and logged tool call cannot match themselves. Direct targets are authorized before summary, trace, event, or title reads. `session_summary` reports only the first user objective, assistant messages with explicit decision wording, supported file-mutation calls, and the latest open todo list, each with its event sequence number. Lineage output replaces unauthorized ancestor and descendant boundaries with markers that contain no hidden session id.

Every trusted `ctx.sessionQuery` call crosses one model-boundary sanitizer. Caller cancellation is checked first and preserved exactly. Available corpus and provider diagnostics, including safely inspectable nested causes, are logged internally on a best-effort basis; unprintable failures use a fixed log placeholder. Diagnostic formatting and error classification are independently guarded, so an unprintable cause cannot escape or prevent a safely classified outer error, while unsafe classification or logging falls back to the fixed `SESSION_QUERY_TOOL_FAILED` code and message. Local argument-validation and authorization errors retain their precise tool-owned messages.

Before any result reaches the model, this package replaces recognized credential assignments, HTTP authorization values, and common provider-token forms with `[redacted]`, then applies `maxResultBytes` without splitting a UTF-8 code point. Redaction reduces accidental disclosure but is not a secret classifier; workspace authorization remains the access control. A generic spill policy can impose a stricter rendering policy but cannot enlarge this package's result limit.

## Model Experience

### System prompt

#### What the model sees

The model receives one fixed prior-history guidance section.

##### Prior-history guidance

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Use session_summary for a bounded event-backed overview of an authorized session. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.
```

#### Token effect

One fixed concise section is present on each request while the plugin is mounted.

#### KV Cache effect

Prefix-stable while the plugin and guidance text are unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [`session_search`, `session_event_search`, `session_summary`, `session_trace`, `session_event_trace`, and `session_event_read` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query). Search filters add fixed schema tokens, while cursors, workspace paths, output pagination, and model-controlled result limits remain absent.

#### Token effect

Six fixed read-only schemas are sent on each request while visible.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results

#### What the model sees

Each successful call emits one plain-text block. `session_summary` includes event-sequence-backed objective, decisions, observed changed files, and open todos. Search results include titles and best-match excerpts; traces include authorized relationships; event reads include target JSON. Every model-visible result is redacted and bounded by `maxResultBytes`.

#### Token effect

Results are data-dependent and remain in logged tool history until compaction; `maxSearchResults`, `summaryMaxItems`, `summaryMaxEvidenceCharacters`, and `maxResultBytes` bound their size.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- Search returns at most the deployment cap and asks the model to narrow its query when more matches exist; it offers no continuation token.
- Workspace identity is conservative exact-string `cwd` equality, so symlink-equivalent paths do not share authority.
- Credential-shaped redaction cannot recognize arbitrary secrets embedded in ordinary prose or structured values.
