# Agent Note: Evidence-oriented agent tools

Status: proposed

English | [中文](2026-08-24-evidence-oriented-agent-tools.zh.md)

## Problem

Coding agents need evidence from work that happened outside their immediate context window: prior Sessions, source syntax, test failures, repository history, persistent runtime state, and rendered browser state. Loading complete JSONL transcripts or raw command output makes that evidence expensive, noisy, stale, and capable of disclosing secrets. Text-only search also cannot distinguish source code from comments or strings, while generic shell access does not give the model compact, comparable diagnostic results.

The existing [`@deepseek-ai/dsh-tool-session-query`](../../../../packages/session-query/tool-session-query/README.md) already provides opt-in, workspace-authorized full-text Session search and exact event inspection. It deliberately does not offer a compact Session summary, stale-context facts, redaction for model-visible historical content, structural code search, project memory, normalized test reports, Git provenance, language kernels, or browser DOM evidence. Each missing capability currently forces an agent either to reconstruct too much data with general tools or to work without the relevant evidence.

## Proposal

Introduce an opt-in family of evidence-oriented tools. Each tool returns a bounded, readable result with source locations or durable event references, and its full result remains an ordinary logged `tool/result`. A tool must not read an entire transcript, repository history, process environment, browser profile, or command log merely because the model supplied an identifier. Settings own deployment-varying limits, timeouts, storage locations, and permitted backends.

### Prior-Session retrieval

Extend `@deepseek-ai/dsh-tool-session-query`; do not introduce `read_whole_chat`. `session_search` and `session_event_search` remain discovery operations, and `session_event_read`, `session_event_trace`, and `session_trace` remain the exact follow-up operations. Add `session_summary(session_id)` as a bounded, event-backed overview: stated objective, recorded decisions, explicitly observed changed files, unresolved work, Session title, last-event time, and only logged revision information. Every summary field cites the event or report that supports it; unavailable facts stay absent rather than inferred.

Cross-Session results remain restricted to the caller's exact workspace identity. Historical extraction, full-text indexing, summaries, snippets, traces, and exact reads pass through one secret-redaction policy before content reaches a model-visible result. That policy preserves an explicit redaction marker and result provenance, so an agent can see that information was withheld without receiving it. Each result labels its source Session and last recorded fact, allowing the caller to decide whether the evidence may be stale.

### Structural code search and rewrite planning

Add a source-analysis capability with an `ast-grep` Service Provider as the first backend. The model can make syntax-aware queries that report language, file, range, matched node kind, and a bounded source excerpt. A structural rewrite first returns a normal diff proposal; applying it uses the existing filesystem mutation policy and version guard. The capability never treats a match inside a comment or string as a syntactic call site.

### Project memory

Add a workspace-scoped project-memory store for durable operating knowledge that is not a Session transcript: platform constraints, project conventions, validated commands, and decisions with their evidence. `project_memory_search` returns bounded matching entries, while `project_memory_record` writes a validated entry only when the mounted policy permits it. Entries carry an evidence reference, workspace scope, recorded revision when available, author, expiry or revalidation rule, and sensitivity classification.

Project memory is a dedicated store, not `.agents/notes/`, and it never receives secrets, credentials, raw transcripts, browser cookies, or unbounded tool output. Retrieval is explicit and ranked; unreviewed memory does not become unconditional prompt text at task start. A later policy may select trusted, current entries for injection after usage evidence shows that it improves task success.

### Structured test and diagnostic reports

Add a test-runner consumer over configured command profiles. It executes the selected test command through the existing subprocess and sandbox policy, recognizes supported runner output, and returns a normalized report containing status, elapsed time, failing test names, concise stack traces, assertion diffs, and a locator for retained redacted output. The model sees no fabricated pass/fail classification when a runner format is unknown; it receives the command outcome and an explicit unsupported-format diagnostic instead.

### Read-only Git intelligence

Add a Git inspection tool that presents targeted `blame`, file history, commit range, and changed-module queries with repository-relative locations and commit identifiers. It accepts only read-only operations. Staging, committing, pushing, rebasing, and other mutations remain the responsibility of their existing command and approval paths.

### Stateful language kernels

Add a configured language-kernel provider for short Node.js and Python experiments when one-shot code execution or a PTY is not enough. `repl_eval`, `repl_inspect`, and `repl_reset` operate on an Agent-owned kernel with bounded state, process lifetime, output, and resource use. Kernels share the selected execution world and sandbox policy, dispose when their owner disposes, and never become a process-global store shared by unrelated Sessions.

### Browser and DOM evidence

Add a browser capability separate from HTTP web search and fetch. Its initial provider runs an isolated headless profile with no user cookies. Read-only tools return a bounded accessibility/DOM snapshot, screenshot, console errors, and failed network requests for an allowed origin. Browser actions, authenticated profiles, downloads, and any external mutation require separately configured support and the existing permission policy. Snapshot extraction strips credentials, form values, cookies, authorization headers, and other sensitive browser state before a result is logged or shown to a model.

## Delivery order

The proposed order is deliberately outcome-based rather than a committed release schedule:

1. **Now — Session evidence and test diagnostics.** Add `session_summary`, uniform redaction and freshness facts to the current Session-query family, then make routine test failures compact and comparable.
2. **Next — Structural code and Git evidence.** Add AST-based matching and rewrite proposals, followed by read-only provenance and changed-module inspection.
3. **Later — Project memory, kernels, and browsers.** These require retention, resource-lifecycle, and privacy policies that should be designed from observed use of the earlier evidence tools.

This proposal does not remove or delay an existing committed item. Each delivery stage needs a separately owned implementation proposal before it is scheduled.

## Alternatives considered

**Expose a raw `read_whole_chat` or transcript-download tool.** Rejected because it spends context on irrelevant history, makes stale statements look current, and can copy secrets into a new Session. Search, summary, trace, and exact bounded reads preserve the investigation path without automatic bulk disclosure.

**Use plain `grep` and arbitrary shell commands for every evidence need.** Rejected because syntax queries, cross-Session authorization, normalized test diagnostics, Git provenance, and browser snapshots have different data models and failure semantics. General tools remain useful follow-ups, not the primary evidence interface.

**Automatically inject all remembered project facts at the beginning of every task.** Rejected because old or untrusted memories become prompt noise and may bias work toward obsolete decisions. Retrieval must stay scoped, source-backed, and bounded.

**Fold DOM automation into the existing HTTP web capability.** Rejected because a browser owns cookies, page state, render timing, and external action risk that HTTP search and fetch do not have. A separate capability keeps its isolation and permission rules visible.

## Acceptance criteria

- Session discovery, summary, trace, and exact read remain bounded, workspace-authorized, source-labelled, and redacted before model visibility; no tool accepts a whole-transcript request.
- The AST backend distinguishes syntax nodes from comments and strings, returns stable locations, and sends every rewrite through the ordinary diff and filesystem policies.
- Project-memory entries are workspace-scoped, evidence-backed, sensitivity-classified, expirable, and independently searchable; automatic prompt injection remains disabled until a policy explicitly enables it.
- Supported test profiles return parsed failures and a redacted retained-output locator; unsupported output never receives an invented classification.
- Git inspection is read-only and returns deterministic commit and path references for blame, history, and change-range operations.
- Language kernels are Agent-owned, sandboxed, resource-bounded, and disposed with their owner; unrelated Sessions cannot read their state.
- Browser snapshots use an isolated profile and redact sensitive browser state; actions and authenticated browsing are absent unless a later provider and permission policy enable them.
- Every model-facing tool has static schemas, documented render intent, focused unit coverage, a keyless assembled snapshot, and configuration validation. A composed deployment mounts only the tools its profile enables.

## Risks

- A redaction policy can miss a credential format or redact useful diagnostic context. It must be centrally tested against representative tool, transcript, Git, terminal, and browser data before any historical content is exposed.
- Session summaries and project memory can become stale. Event references, last-recorded facts, revision metadata when available, and expiry rules make uncertainty visible but cannot prove the checkout still matches.
- AST parsers and test-output adapters can fail on unsupported languages or runner versions. Tools must report their unsupported state instead of falling back to misleading text parsing.
- Persistent kernels and browsers hold state longer than one-shot commands. Lifetime caps, owner-scoped disposal, sandboxing, and explicit profile selection contain that state at the cost of some convenience.
- This is a broad family of tools. The delivery order prevents a browser or memory subsystem from becoming a dependency of basic Session and diagnostic improvements.
