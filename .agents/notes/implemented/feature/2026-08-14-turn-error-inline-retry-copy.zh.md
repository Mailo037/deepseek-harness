# Agent Note: 轮次错误内联重试与复制操作

Status: implemented

[English](2026-08-14-turn-error-inline-retry-copy.md) | 中文

## 问题

终端轮次失败此前只渲染为一行静态状态（“本轮运行失败”加上适合展示的消息与可选错误码）。读者只能手动继续：自己编写一条续跑提示，而要把失败消息复制进 bug 报告，也只能在转录行里手工选中文本。

## 决策

`turn-error` 聊天节点在其状态行下方渲染一条内联操作条：一个 **重试** 按钮和共享的复制 IconActions（复制错误消息）。

- 重试会发送一条排队用户轮次，提示为本地化的续跑文案（`message.turnError.retryMessage`：“发生意外错误，请继续你之前的工作。” / "An unexpected error occurred, please continue what you were doing."）。它走普通发送路径 —— 会话作用域的 `conversation.send` —— 因此被发送的提示是一条持久的、可见的用户消息，后续每个轮次都能看到（[model-visible ⟺ logged](../../../../docs/architecture.md)）。
- 复用 `MessageIconActions` 实现复制，以错误的展示安全消息作为复制文本；沿用既有的 copied/check 切换样式。
- 回调通过槽系统到达渲染器，而不是服务导入：`ChatNodeOwnerProps` 新增 `sendMessage(text)`，由 chat view 条目的 inject 通过 `scopedConversation(...).send(...)` 提供。被拒绝的投递落入快照的 `promptError`；inject 吞掉该 rejection，因为调用方没有任何可恢复手段。
- 按钮位于 `role="status"` 元素之外，屏幕阅读器播报的仍然恰好是失败文本本身。
- 每个历史轮次错误都显示该操作条，而不只是最新一个；运行中重试会把续跑提示投递到下一轮队列前端，因此它先于任何先前排队消息运行（[轮次错误重试插入队列前端](../bug-fix/2026-08-25-turn-error-retry-prepends-to-queue.zh.md)）。

背景：失败本身及其 AUTH 净化由 [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.zh.md) 负责；本笔记只是在该节点之上增加呈现层 affordance。

## 备选方案

**经 `inputActions.setDraft` + `submit()` 注入草稿** — 否决：submit 会消费用户已输入的草稿，一次重试点击可能悄悄毁掉正在进行的输入。conversation 服务的发送路径不触碰草稿。

**对模型不可见的隐形 nudge**（发送但不进入转录记录）— 否决：仓库级规则要求任何到达模型请求的输入都必须能从会话日志重建；隐藏输入需要新增 session event，还会让后来的读者无法理解轮次为何继续。

**只在最新轮次错误上显示重试 / 运行中禁用** — 目前否决：queue 语义已经让运行中的点击无害，而“仅最新”的门槛会让渲染器耦合它本来不需要读取的 timeline 状态。若旧错误上的误点成为真实问题再重新评估。

## 影响

chat-node owner currency 增加了一个必填成员（`sendMessage`），每个 keyed 渲染器的 props 字面量都必须提供；生成的 client slot catalog 记录契约源码，并在同一次变更中重新生成。续跑提示是会进入模型上下文的本地化 UI 文案，因此其措辞由 locale 词典固定，而不是交给模型。组件覆盖在 `chat-view.client.spec.tsx` 中钉住重试手势（回调收到本地化续跑文案）和每块的复制操作。
