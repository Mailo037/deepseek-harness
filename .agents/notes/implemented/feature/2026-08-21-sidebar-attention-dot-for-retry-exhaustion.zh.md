# Agent Note: 侧边栏重试耗尽会话的注意状态点

Status: implemented

[English](2026-08-21-sidebar-attention-dot-for-retry-exhaustion.md) | 中文

## Problem

当会话的模型请求重试预算耗尽（即"5/5 次重试全部失败"）时，侧边栏显示的是绿色"已完成"或"空闲"圆点——与成功完成的会话外观相同。用户无法从侧边栏判断 AI 的最后一个回合在耗尽所有重试后失败了，因此可能直到打开会话才注意到失败。

## Decision

主机的 `session.list` 摘要和 `host/session-status` 实时帧新增了 `attention` 字段（`'retry-exhausted' | null`）。只要最新回合在耗尽重试预算后以终端错误结束，侧边栏就显示红色 **error** 圆点并标注"需要关注"，取代绿色"已完成"或"空闲"圆点。

### Host-side derivation

`sessionListMetadata` 投影单元——即 `session.list` 已使用的持久化提示——新增了 `attention?: 'retry-exhausted'` 字段。折叠函数 `applySessionListMetadata` 跟踪内部 `exhaustedRetryTurn` 计数器：当 `llm/retry` 事件以 `retry === maxRetries`（`normal` 模式）到达时，该回合被标记为预算已耗尽。当 `turn/end` 的 `reason.kind === 'error'` 且回合匹配时，折叠函数设置 `attention = 'retry-exhausted'`。`assistant/message` 事件清除该跟踪（重试尝试已恢复），`turn/start` 同样清除（新回合取代之前的判定）。`view` 函数剥离内部跟踪字段，只发布干净的公开提示。`stateVersion` 从 1 提升到 2，以丢弃过期的缓存行。

`summarize()`（已附加会话）和 `summarizeCold()`（基于投影缓存的冷会话）都会在返回的 `SessionSummary` 中包含 `attention`。`agent/status` 处理器也会在帧生成时计算折叠结果，并在 `host/session-status` 帧中包含 `attention`，无判定时为必填的 `null`（这样客户端就能从实时通道同时设置和清除该判定）。

### Wire contract changes

- `SessionSummary` 新增 `attention?: 'retry-exhausted'`——`session.list` 行携带实时与冷路径的判定。
- `HostFrame['host/session-status']` 新增必填的 `attention: 'retry-exhausted' | null`——每次状态翻转都携带权威判定。
- `SessionListMetadata` 新增 `attention?: 'retry-exhausted'`——持久化投影提示为冷会话携带该判定。

### Client-side propagation

主机线协议字段依次流过 `SessionManager.applyMutation`（status 与 upsert 变更）、`SessionListEntry`、`projectList` 中的客户端 `SessionSummary`、`tree.ts` 中的 `SessionNode`/`SearchResultNode`，最后到达 `Rows.tsx` 的 `sessionStatuses()`。该状态函数在检查 `completed` 或回退到 `idle` 之前返回 `[{state: 'error', label: '需要关注' / 'Needs attention'}]`，因此只要判定存在，红点就会取代绿点。完成提醒（completion notification）仍会在 running→idle 边沿触发，但在视觉上被注意判定覆盖。

## Alternatives considered

### Client-side derivation from the event log

客户端可以从会话事件窗口计算重试耗尽判定。被否决，因为侧边栏必须为未打开、没有内存中 Session 实例（因此也没有事件窗口）的会话显示正确圆点。对这类行而言，摘要是唯一的数据来源。

### Re-pull the session list on every running→idle transition

与其扩展 `host/session-status` 帧携带 attention，不如让客户端在会话停止运行时重新拉取 `session.list`。被否决：主机帧正是这类事实的既有实时通道，而列表重拉更重（RPC 往返、序列化每一行）。在折叠结果已计算的前提下，实时帧扩展是显式且零成本的。

### Amber/warning dot instead of red error

StateDot 的琥珀色 `warning` 状态用于待处理用户交互（审批、提问）。将其复用于"重试耗尽"会模糊"等待用户输入"与"AI 失败"之间的语义边界。红色 `error` 状态清晰表达失败，且用户明确提到"rot oder Orange"（红色或橙色）。红色是无歧义的选择。

## Consequences

- 5/5 重试失败的会话现在在侧边栏显示红色错误圆点——用户无需打开聊天即可看到失败。
- 对于投影缓存检查点已覆盖失败回合的冷会话，该判定在主机重启后仍然存在。
- 新回合开始（用户发送新提示）后，attention 自动清除——会话重新工作中。
- `sessionListMetadata` 投影的 `stateVersion` 提升会使现有缓存行失效；下次追加时从日志重新派生，这是既定的缓存升级机制，无数据丢失风险。
- 整个改动约 400 行、20 个文件（主机类型、线协议 schema、折叠逻辑、客户端运行时、树、行组件、本地化、测试与基础设施），所有测试通过。