# `@deepseek-ai/dsh-tool-rebuild`

[English](README.md) | 中文

面向模型的 `rebuild_harness` 工具，适用于从源码检出运行的 Web 宿主：调用方 agent 可以自行重建 harness 并重启宿主，无需人工操作终端。一次调用会停止该 agent 正在运行的后台作业（对每个作业执行 `kill` 加有界等待），把每个作业的 id、kind、label 与结束状态记录进已落日志的工具结果中，并在调用回合结束时安排重启 —— 通过 `whenIdle()` 等待，使携带作业记录的结果在进程退出前先进入会话日志。重启本身复用 [self-update](../self-update/README.zh.md) 机制：`quiesceAgents()` 取消所有活跃 agent 的回合（排队的收件箱工作对恢复后的会话仍然保留），`createWebUpdateHandoff({host, port}, {pull: false})` 构建分离的 helper，再由启动器的 `ctx.appLifecycle.restart` 交接；helper 等待端口释放，运行 `pnpm run build`，并以 `--no-open` 重新启动同一 Web 调用。重启之后，模型恢复会话，读到日志中的作业列表，并重新启动自己拥有的作业。

配置：`jobStopTimeoutMs`（10 000）限定单个作业的结束等待；到 Bound 仍未结束的作业按当前状态记录。该工具声明 `timeoutMs` 30 000。

缺少启动器重启能力、缺少 `ctx.selfUpdate` 或缺少 Web 服务器的部署会让调用以指明缺失能力的错误失败；缺少 `ctx.jobs` 的部署仍会以空作业记录完成重建。Helper 的重启复用原始调用的参数，因此通过 `pnpm dsh:web` 启动的宿主会带着它的 `--profile web` 与 `--trusted-host` 值回来；构建步骤是仓库的完整 `pnpm run build`（`build:lib` 加 `build:web`），而不是面向 Android 的 `pnpm dsh:build`。

## Model Experience

### Tool schemas

#### What the model sees

在工具可见时，是生成的 [`rebuild_harness` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-rebuild)。

#### Token effect

工具可见的每条请求都有固定的 schema 成本。

#### KV Cache effect

在工具定义与可见性不变时保持前缀稳定。

### Rebuild result

#### What the model sees

每次调用一个结果块。它把每个被停止的作业列为 `<id> [<kind>] <label> -> <status>`，说明 Turn 结束后的重建是否已安排，并且 —— 在新安排时 —— 指示模型在重启之后先重新启动列出的作业，再恢复其他工作。

#### Token effect

该块在压缩之前一直留在父历史中；停止作业列表会随 agent 在该回合内运行的作业数量增长。

#### KV Cache effect

仅追加；结果跟随可复用的请求前缀，不会使既有条目失效。

## Known Limitations and Deferred Work

- **浏览器遮罩不展示由工具触发的重建** —— GUI 的更新进度界面只跟踪由 GUI 发起的更新；工具触发的重建在浏览器看来只是断开连接，直到新宿主完成绑定。
- **宿主平面可见性是有意为之** —— 因为重启是进程级事实而非会话级能力，每个 Web 会话的 agent 都能看到该工具；从 web bundle patch 中移除该行即可收回。
