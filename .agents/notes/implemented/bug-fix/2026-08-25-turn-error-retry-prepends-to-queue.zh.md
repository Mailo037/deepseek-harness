# Agent Note: 轮次错误重试将继续提示插入队列前端

Status: implemented

[English](2026-08-25-turn-error-retry-prepends-to-queue.md) | 中文

## 问题

轮次错误（turn-error）的“重试”按钮通过 `conversation.send()` → `session.prompt(mode: 'queue')` → `agent.followup()` 发送本地化的继续提示（“发生意外错误，请继续你之前的工作。”），这会把继续提示**追加**到下一轮队列的*末尾*。当用户已经排队了消息（在失败的轮次运行期间输入）时，排在最前面的排队消息会成为下一轮，而不是重试的继续提示。

重试原本的设计是“排在其后”（见原始 Agent Note 2026-08-14-turn-error-inline-retry-copy），但这违背了用户的预期：按下“重试”应立即投递继续提示——而不是之前排队的消息。

## 决策

端到端新增 `prepend` 投递模式，使重试的继续提示插入到下一轮队列的**前端**，先于任何已排队的消息。

### Agent 接口（`packages/core/agent`）

在 `Agent` 接口中新增公开方法 `Agent.prepend(message)`，并在 `ReactLoopAgent` 中实现。它镜像 `followup`，但改用 `Inbox.prepend('next-turn', input)` 而非追加，并使用相同的唤醒分类逻辑唤醒驱动器。

### 主机 API（`packages/host/apiproxy`）

`sessions.prompt` RPC 在 `'queue'` 与 `'steer'` 之外接受第三种模式 `'prepend'`。当模式为 `'prepend'` 时，处理器分派 `agent.prepend(message)`。

### 客户端运行时（`packages/client/runtime`）

`ISession.prompt` 的模式联合扩展为 `'queue' | 'prepend' | 'steer'`。具体 `Session.prompt` 原样透传模式。

### 界面会话（`packages/client/ui-conversation`）

- `IConversation.send` 增加了可选的 `mode` 参数（默认为 `'queue'`），使重试接线可以请求 `'prepend'`。
- `apply.ts` 中 turn-error 的 `sendMessage` 注入调用 `scoped.send(text, 'prepend')`——继续提示现在投递到队列前端。
- 槽位契约的 JSDoc 更新为“立即下一轮”语义。

### 语义

- **空闲驱动器 + 已停驻的队列**（失败轮次后的典型场景）：重试消息成为下一个轮次；排队消息按原顺序随后执行。
- **运行中的驱动器**：重试消息位于下一轮队列前端，因此它在当前轮次结束后、任何先前排队轮次之前运行。
- **空队列**：行为与 `followup` 完全一致（启动一个轮次）。

## 备选方案

**客户端两步（prompt + updateQueue move）。** 客户端先发送提示（queue 模式），然后立即通过 `updateQueue` 将行移动到索引 0。这存在竞态：主机驱动器可能在 move RPC 到达之前启动下一个排队的轮次，导致 move 以 `queue-item-not-found` 失败。已拒绝。

**Steer 模式。** Steer 投递到 `next-step` 收件箱，该收件箱与第一个 `next-turn` 项在同一轮步骤中被一并认领。若存在排队消息，重试消息与第一条排队消息将进入同一轮次——不符合用户预期。已拒绝。

## 影响

- 重试按钮现在无论是否存在排队消息，都能可靠地将继续提示作为立即的下一轮发送。
- 线上协议新增模式值（`'prepend'`）。主机 schema、客户端契约与 Agent 接口的联合类型同步扩展。未更新 `'prepend'` 的处理器会在 schema 校验层（Zod）或 Agent 接口层（TypeScript）被拒绝。
- 合并后应重新生成 `cordis-client-runner` api-catalog 与 `tool-cordis` api-catalog（`pnpm run gen-cordis-api` 与 `pnpm run gen-cordis-inspect-catalog`），使生成的 ISession 声明与扩展后的模式联合保持一致。
- `chat-view` 组件测试仍然通过：回调收到的本地化继续提示文本不变，仅投递模式不同。