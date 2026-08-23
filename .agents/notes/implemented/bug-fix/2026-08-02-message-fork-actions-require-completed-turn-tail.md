# Agent Note: Message fork actions require a completed turn tail

Status: implemented

English | [中文](2026-08-02-message-fork-actions-require-completed-turn-tail.zh.md)

## Problem

The Web conversation derives Copy, feedback, clock, and branch actions from the last Assistant node with nonempty text in each turn. The completed `turn-tail` initially kept that Assistant's render position, so a later tool result, interrupted reasoning node, retry, or terminal error appeared below the entire action row. The Host correctly expands the message anchor through the containing `turn/end`, but the placement presented the actions as a boundary while more work from the same turn remained below it.

## Decision

The conversation projection publishes one `turn-tail` only when the durable `turn/end` arrives. The tail retains the last content-bearing Assistant as the Copy, feedback, and branch target, but its render anchor follows every Assistant, Think, tool, retry, and terminal row produced by the turn. A steering message admitted after the model output remains below the completed footer. Open turns have no action row, and no later model text or tool call can render underneath one.

Branch is enabled only when the targeted Assistant is also the completed turn's last transcript node. A later tool result, reasoning-only interruption, turn error, or other transcript node leaves branch unavailable while Copy, feedback, and timing remain usable at the turn tail. The unavailable control stays visible, focusable, and hoverable; `aria-disabled`, a tooltip, and `aria-describedby` explain the completed-tail requirement without sending a Host request. The Host's completed-turn fork semantics remain unchanged.

The message-bubble half of this eligibility is superseded by the [user-bubble branch removal](../simplification/2026-08-06-user-bubbles-drop-the-branch-action.md): user and steering bubbles no longer render the control at all, so only content-assistant tails may fork; the assistant-side gate and its visible-but-unavailable presentation stand.

This narrows the message eligibility established by the earlier [Web session fork action decision](../feature/2026-07-27-web-session-fork-actions.md). Session-row forking still selects the latest completed turn, and eligible message actions still pass their event seq through the shared client runtime operation.

## Alternatives considered

**Cut the event log at the clicked assistant message.** Rejected because an assistant message can sit inside an open step and can contain tool calls whose results occur later. A raw prefix at that seq is not a balanced turn and may not be a valid provider transcript.

**Keep the action row directly under the closing Assistant.** Rejected because the row visually terminates the response even when later Think, tool, retry, or error rows belong to the same turn. Disabling only Branch does not correct Copy and feedback appearing above unfinished work.

**Anchor the footer after the `turn/end` sequence number.** Rejected because a steering message may be durably admitted before `turn/end` while belonging visually after the completed response. The footer follows model and tool output, not later user-authored steering.

**Infer completion from `running` or the next user message.** Rejected because retry and steering turns need not align with the next visible user bubble, and a paged window may omit that later bubble. The durable `turn/end` event is the authoritative completion fact.

**Hide branch from every interrupted turn.** Rejected because an aborted turn is durably closed and its final interrupted text can be the true transcript tail. Eligibility depends on the completed boundary and node order, not the outcome kind.

**Hide ineligible message controls.** Rejected because a disappearing control does not explain the boundary requirement and shifts otherwise stable message chrome. A focusable unavailable control preserves the affordance while preventing the request.

## Consequences

An enabled branch icon denotes the same completed-turn boundary that the Host will copy. In a response → tool → interrupted Think sequence, every work row renders before Copy, feedback, clock, and the disabled branch control; later steering still renders after those actions. This change deliberately does not provide same-turn transcript editing or a retry-before-turn operation; the Session-row action remains available when a reader wants to copy the latest completed turn in full. Conversation-definition tests pin ordering after trailing tools and before steering, while component tests cover the completed/open transition and unavailable branch controls.
