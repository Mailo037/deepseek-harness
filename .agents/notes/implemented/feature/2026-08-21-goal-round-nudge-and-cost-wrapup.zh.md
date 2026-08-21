# Agent Note: Goal-round nudge, bounded error retry, and cost wrap-up

Status: implemented

English | [中文](2026-08-21-goal-round-nudge-and-cost-wrapup.md)

## Problem

一个已激活（armed）的目标只由事件驱动。某个 round 出错时会解除目标激活并要求之后人工 `resume`，因此一次瞬时 provider 或持久化故障就会让本应继续的自治目标停摆；又因为每个触发都来自事件，当一个 agent 空闲而其目标已激活却又没有后续 goal change 或轮次转换时，它可能带着未决的预约无限期静默下去。另外，当模型最终报告 `complete` 或 `blocked` 时，收尾消息对整目标成本没有任何依据——它消耗了多少 token、运行了多久。

## Decision

[goal-round 驱动器](2026-07-19-same-session-goal-round-driver.md)与[面向模型的 goal 工具](2026-07-19-model-facing-goal-tools.md)获得三项行为。全部通过驱动器上的新配置加入。

### 周期性 nudge

驱动器在其单一的合成 Cordis effect 内安装一个进程本地 `setInterval`（`nudgeIntervalMs`，默认 `30000`）。每次 tick 遍历在线的 `states` 映射，并对任何当前目标为 `active` 且 `armed`、状态为 `idle`、且没有竞争排队工作的 agent 调用 `requestDrive(state)`。`drive()` 会重新检查每个静止谓词与持久目标本身，因此已 complete、paused、blocked、disarmed 或达到上限的目标为 no-op，并发的普通 prompt 仍然让位。间隔在 teardown 时最先被清除。由于驱动器其余部分完全由事件驱动，此定时器是一种防御性冗余而非主要轮次来源：没有它独有的面向模型 prompt 或会话事件。

### 连续错误重试与阻止

`agent/error` 边界不再无条件解除激活。当错误属于一个预约处于 `claimed` 或 `admitted` 的 round、且目标仍为 `active`/`armed` 时，驱动器递增该 agent 的 `consecutiveErrors` 计数器并保持激活，以便下一次空闲检查点或 nudge 重新排队同一下一个 round。当该计数器达到 `consecutiveErrorLimit`（默认 `5`）时，它以代码 `repeated-error` 阻止目标，消息为 `Goal rounds failed N consecutive times; last error: <error>`。成功的 `turn/end`、任何 `goal/changed` 与 `session-start` 都把计数器重置为零。

无法归属到已接纳 round 的失败（人工轮次，或只到达 `queued` 的 round）仍会解除激活，与旧行为一致。这有意取代驱动器笔记中此前的「任何异常结果都不自动重试」规则：瞬时 provider 错误现在会被自动重试，并由 `consecutiveErrorLimit` 约束。限流、provider 鉴权失败与持久化失败有意不被分类——损坏的循环会在耗尽 `consecutiveErrorLimit` 后进入 `repeated-error`，而非烧光整个 `maxGoalRounds` 预算；盲目重试的限制在包 README 中记录。

### 整体目标成本收尾

当自治 goal round 报告 `complete` 或 `blocked` 时，`dsh-tool-goal` 现在从所属会话日志派生整目标成本，并渲染进延后的收尾消息块（`wrapup.ts`）。`goalWrapupStats(agent, goal)` 累加目标 create 变更之后每一步中 provider 报告的 `assistant/message` usage（`inputTokens + outputTokens + cacheRead + cacheWrite`），并报告自 `goal.createdAt` 起的 `elapsedMs`。若没有一步报告 usage，则省略 token 数字。收尾块新增一行资源说明，模型被要求在其收尾消息中原样复述一次，例如 `The whole goal took 2m 5s and consumed 1,240 tokens. State both numbers once in your closing message.`。紧凑工具结果值保持不变。

## Alternatives considered

- **让所有错误都解除激活。**不予采纳，因为这会让一次瞬时 provider 故障把自治目标拖在必需的人工 `resume` 之后，这正是一般性问题；重试是有界的，因此不可恢复的循环不会静默耗尽 round 预算。
- **在重试前对失败分类（限流 vs 鉴权 vs 持久化）。**不予采纳，因为驱动器没有可靠分类器，分类会把它与 provider 语义耦合；对每次已接纳 round 失败计数并设硬上限更简单也更安全，独立的资源策略仍待后续。
- **把 nudge 做成对总不活动解除激活的严格看门狗。**不予采纳，因为目标已有显式 round 上限和 `consecutiveErrorLimit`；再加一个墙钟空闲超时会成为第三个冗余停止策略。
- **持久化连续错误计数器或 token/时间合计。**不予采纳，因为计数器只是调度状态（与 activation 一样为进程本地），成本数字是派生、无损且可从会话日志重放的；持久化任一都会为一次性数据增加持久 schema。

## Consequences

- 一次瞬时 round 错误会在下一次空闲检查点或 nudge 时自动重试，直至 `consecutiveErrorLimit`；一旦超过上限目标便以 `repeated-error` 阻止，符合「失败要大声，绝不静默烧预算」。
- 驱动器现在有两个可调参数（`nudgeIntervalMs`、`consecutiveErrorLimit`），因此[驱动器笔记](2026-07-19-same-session-goal-round-driver.md)中此前的「插件无配置」声明在此不再成立；本笔记取代该部分，新值只写在本笔记与包 README 中。
- 完成后或阻止时的收尾消息以整目标耗时、并在 provider 报告 usage 时以 token 总量为依据，因此模型（与用户）无需额外记账 UI 就能得到具体的成本摘要。
- 重试是盲目的：每次已接纳 round 失败都计数，因此持续 provider 中断会在 `consecutiveErrorLimit` 次 round 后到达 `repeated-error`，而非无限重试或静默解除激活。

## Testing

驱动器单元套件覆盖新的重试路径（瞬时错误后成功到达 `round-limit`；连续错误阻止 `repeated-error`；`turn/end` 失败在达到配置次数后阻止 `repeated-error`）、非 round 失败的解除激活边界、一次失败 round 后的 round 上限阻止，以及在 fake timers 下 interval nudge 推进一个空闲已激活目标。tool-goal 套件断言收尾块指明耗时与累加后的 token 总量（对 120/80/40 的 usage 事件为 240），并让模型把两个数字各复述一次。其余 goal、command-goal 与 invariant 套件均原样通过。
