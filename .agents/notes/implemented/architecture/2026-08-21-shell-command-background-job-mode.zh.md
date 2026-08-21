# Agent Note: `!` 人类 shell 命令的后台任务模式

Status: implemented

[English](2026-08-21-shell-command-background-job-mode.md) | 中文

## 问题

此前每条以 `!` 为前缀的 composer 行都在前台同步执行：`ctx.shellCommand.run` RPC 会阻塞在 shell 命令上，结果只在命令结束后才到达 agent。机器在命令结束前什么都看不到——无法检查、等待或停止正在运行的 `!` 命令。长时间运行的命令会阻塞浏览器 RPC，并在整个过程中让 UI 终端卡片停留在「运行中」状态。

## 决策

为 `@deepseek-ai/dsh-shell-command` 增加一个含两个取值的 `mode` 配置：

- `direct`（默认）：原有的同步前台执行。命令运行到完成，`shell/done` 卡片结束，随后向 agent 发送一条附带最终输出的用户消息。
- `tool`：命令立即作为 `ctx.jobs` 拥有的后台任务启动。`run` RPC 立刻返回（永不阻塞），并立即向 agent 发送一条命名正在运行任务 id 的用户消息（可用 `job_output`/`job_kill` 检查或停止它）。任务结束时 `shell/done` 卡片结算，保留终端块的 UI。

### 为什么不在 agent 循环中伪造合成 tool-call

最初的设计打算在会话日志中注入一条合成的 `assistant/message`（含 `tool-call` 块）以及 `tool/call`/`tool/result` 事件，让机器看到一条 `run_in_background: true` 的 bash 工具调用，就好像是它自己发起的一样。实现在实现过程中否决了该方案，原因如下：

1. **违反会话不变量。** `assistant/message`、`tool/call`、`tool/result` 事件类型要求存在已打开（open）的 `turn/step` 边界（会话不变量中的 `requireOpenStep`）。从任何轮次之外的独立 host 服务追加它们会把会话标记为损坏。
2. **需要集成核心循环。** 要保持不变量合规，这些事件就必须从 agent 循环的 `step()` 循环内部写入，这就要在 agent 上新增一个外部 tool-call 通道、并在循环里加一个 drain 点——这是对 `@deepseek-ai/dsh-agent-loop` 的一次深入且具侵入性的改造，伴随大量测试与文档开销。
3. **后台任务路径达成了同样的面向用户目标。** 机器看到一条命名运行中任务的用户消息，可以调用 `job_output`/`job_kill` 检查或停止它，而浏览器 RPC 永不阻塞。`shell/done` 卡片仍以最终结果结算，结算后的输出通过 `deriveMessages` 进入模型的下一次请求。

### 模式默认值

为保证向后兼容，默认值是 `direct`。希望使用非阻塞、可被机器控制的部署可在 `shell-command` 条目的配置里设置 `mode: 'tool'` 来选择。

## 验证

- [`packages/shell/shell-command/tests/shell-command.spec.ts`](../../../../packages/shell/shell-command/tests/shell-command.spec.ts) 通过 9 个测试，覆盖 `direct` 与 `tool` 两种模式：准入、shell 生命周期、会话工作目录、空命令拒绝、stderr 合并、超时渲染，以及 tool 模式的后台任务注册、立即返回的 RPC 与 agent 通知。
- `@deepseek-ai/dsh-shell-command` 包的 TypeScript 编译（`tsc --noEmit`）通过。

## 考虑过的备选方案

**由 host 服务撰写合成 tool-call 生命周期。** 否决（见上）——会话不变量要求已打开的 `turn/step`，在循环之外伪造一个会损坏日志。

**由 host 服务打开合成的 turn/step 边界。** 在 host 服务中打开 `turn/start`/`step/start`、写入 tool-call 事件并关闭边界，可以满足不变量，但 turn/step 编号必须匹配 agent 循环的单调序列，且由 host 打开的边界会产出一个 agent 循环从未拥有的「空心」turn——一种没有先例、没有重放保障、也没有经过测试的 teardown 路径的全新日志状态。

**委托给 `ctx.tools.execute` 执行 `run_in_background`。** `tool-bash`/`tool-pwsh` 工具注册在 agent 作用域（preset 域）中，host 平面的 `shell-command` 服务未必能看到它们。后台任务路径（`ctx.jobs` + `ctx.shell.start`）是 host 平面安全的，规避了可见性问题。

## 后果

- `@deepseek-ai/dsh-shell-command` 新增对 `@deepseek-ai/dsh-jobs`（`JobRegistry` 接口）作为 peer 依赖，且 `tsconfig` 引用 `../../jobs/jobs`。
- `cordis.patch.yml` 中的 `shell-command` 条目现在可以接收 `config.mode` 字段。
- 升级后不设置 `mode` 的既有部署会保持原有 `direct` 行为。
- 在 `tool` 模式下，机器每收到一条 `!` 行会多看到一条用户消息；命令输出本身的 token 成本会推迟到机器读取任务时才产生。
- 在 `tool` 模式下，`shell/done` 卡片只携带退出状态徽章（不含完整输出文本）；完整输出可通过 `job_output` 获取。
- `tool` 模式需要一个已组合的 `ctx.jobs` 注册表（例如 `@deepseek-ai/dsh-jobs-local`），缺少时会在该 `!` 行明确失败。
- 后续工作可在后台任务展示成熟后把 Web bundle 默认设为 `mode: 'tool'`，让 `!` 命令默认非阻塞。