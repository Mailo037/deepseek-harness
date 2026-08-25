# Agent Note: 轮次错误详情展开与完整诊断复制

Status: implemented

[English](2026-08-24-turn-error-details-and-full-copy.md) | 中文

## Problem

终态轮次错误虽然内联渲染了适合展示的消息和可选错误码徽标，但缺少展开查看详细诊断（如 HTTP 状态码、请求 ID 或长错误响应）的视图。此外，复制图标仅复制孤立的错误文本，遗漏了错误码（如 `PI_AI_ERROR`）以及定位问题所需的上下文元数据。

## Decision

1. `turn-error` 聊天节点在其操作条中（**重试** 与复制按钮旁）新增 **详情** 展开切换按钮。
2. 点击详情按钮可展开结构化面板，按需展示错误码、完整错误信息、HTTP 状态码及请求标识。
3. 复制操作的载荷被格式化为完整诊断字符串（`${code}: ${message}`，附带 HTTP 状态与请求 ID），确保复制内容具备可操作的问题排查上下文。
4. `@deepseek-ai/dsh-client-runtime` 中的 `TurnErrorNode` 以及 `@deepseek-ai/dsh-client-ui-conversation` 中的 `turnErrorDefinition` 从 `match.event.data.reason.error` 中转发可选的 `status` 与 `requestId`。

## Alternatives considered

**弹窗或抽屉展示错误详情** — 否决：内联展开更轻量，保留了与失败轮次的上下文关联，且与 `model-retry` 的呈现模式一致。

**直接用完整堆栈替换单行摘要** — 否决：保持初始状态行紧凑且安全展示，仅在需要时按需展开。

## Consequences

- `TurnErrorNode` 携带可选的 `status` 和 `requestId` 字段。
- 复制操作产出用于缺陷报告的完整诊断文本。
- `ui-conversation` 的本地化词典新增 `message.turnError.details`、`message.turnError.hideDetails` 及各详情标签。
- `chat-view.client.spec.tsx` 与 `conversation-node-definitions.client.spec.ts` 补充详情展开收起、格式化复制输出与元数据转发的测试覆盖。
