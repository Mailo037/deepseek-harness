# Agent Note: AI-assisted Harness update review

Status: implemented

English | [中文](2026-08-22-ai-assisted-harness-update-review.zh.md)

## Problem

An installed unofficial Harness can contain three independently evolving sets of changes: the official DeepSeek upstream, changes maintained by the unofficial distribution, and local customizations made by its user. The existing About updater only fast-forwards the current branch to its configured Git upstream. It cannot decide which source changes should be integrated around local behavior, and a blind merge or reset could discard customizations.

## Decision

The About section owns a separate **AI-assisted updates** card built from the shared custom `SurfaceCard`, `LabeledField`, `ComparisonRail`, and `Select` primitives. The user chooses either the maintained unofficial distribution or the official DeepSeek upstream; the unofficial distribution is the default because it carries the product's maintained adaptations. The card resolves the selected Harness Workspace, prepares an ordinary blank session there, loads that session's Host-reported model directory, and lets the user choose the review model. Starting the review sends a durable user prompt and opens that session, so all analysis, questions, approvals, tool calls, and results remain visible in the normal conversation.

The prompt names the selected repository and asks the model to discover its current default branch and newest release tag. It requires local and source versions, merge base, ahead/behind counts, and a three-part ledger covering source changes, maintained fork changes, and local user customizations. Every source change must be classified as integrate, adapt around a customization, or intentionally leave out. Fetching namespaced remote refs is allowed during analysis; tracked-file edits wait for explicit approval. Approved changes use an isolated `harness-sync/*` branch and worktree, never the active tree. Push, merge, release, deployment, restart, reset, rebase, and active-tree cleanup remain outside the review's authority.

The normal app updater remains the credit-free default and can still fast-forward and restart from its configured Git upstream. The AI path is optional: loading the Host model directory makes no model request, and credits can only be used after the user explicitly starts the visible update session.

## Alternatives considered

**Teach the existing self-update service to merge either repository.** Rejected because self-update has a narrow fast-forward and restart contract. Divergent integration requires architectural judgment, conflict review, and user approval rather than a stronger Git mutation primitive.

**Run a hidden background model call and apply its patch automatically.** Rejected because hidden work would remove the normal session log, approval controls, model selector, progress UI, and follow-up conversation exactly where a high-risk integration needs them.

**Hard-code the most capable model.** Rejected because deployments expose different providers and catalogs, and the repository forbids unsupported deployment tunables. The prepared session reports the choices; the user selects one, with its current model selected initially.

## Consequences

The feature reuses existing Workspace, Session, model-directory, prompt, and navigation behavior instead of adding a second agent runtime or Git wire API. It does not display live source version data inside Settings; the launched AI session owns freshness, evidence, and interpretation together. Preparing the model list may create or reuse a blank session, but no model request starts until the user chooses **Start AI update**. The reusable custom card, field, and comparison primitives remain available to other client packages.

## Testing

The controller specs pin both sources and their default, Workspace preparation, Host-reported choices, unadvertised-but-routable current models, model selection before prompt submission, failure recovery, navigation, and the customization and safety clauses in the durable prompt. About component coverage pins the optional-credit copy and assembled custom controls from model loading through opening the visible review session. Primitive coverage pins card labelling, custom-control labels, and decorative comparison semantics. The package apply suite pins the additional Session and Workspace service injections. A keyless Web replay snapshot pins the assembled About card, default source, custom source selector, explicit credit boundary, and source switch without loading or starting a model.
